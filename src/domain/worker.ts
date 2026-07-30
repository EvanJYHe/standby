import { randomUUID } from "node:crypto";

import { DateTime } from "luxon";

import { calculatePastCustomerDiscount, rankRefillCandidates } from "./scheduling.js";
import type { StandbyState, StandbyStore } from "./store.js";
import type {
  Barber,
  Customer,
  OutreachOffer,
  RefillCandidate,
  RefillJob,
  Service,
} from "./types.js";

export interface OfferDelivery {
  offer: OutreachOffer;
  customer: Customer;
  barber: Barber;
  service: Service;
}

export interface OfferSender {
  send(delivery: OfferDelivery): Promise<{ providerMessageId: string }>;
}

export type WorkerRunResult =
  | { status: "idle" }
  | { status: "offer_delivered"; offerId: string; customerId: string }
  | { status: "delivery_failed"; offerId: string; customerId: string }
  | { status: "exhausted"; jobId: string };

const MINIMUM_VOICE_OFFER_EXPIRY_SECONDS = 15 * 60;

function jobCanBeLeased(job: RefillJob, now: DateTime): boolean {
  if (job.status === "pending") {
    return job.retryAt === undefined || DateTime.fromISO(job.retryAt).toMillis() <= now.toMillis();
  }
  return job.status === "leased"
    && job.leaseExpiresAt !== undefined
    && DateTime.fromISO(job.leaseExpiresAt).toMillis() <= now.toMillis();
}

interface WorkerOptions {
  workerId: string;
  idFactory?: () => string;
  leaseSeconds?: number;
  maxDeliveryAttempts?: number;
  priorityVoiceCustomerId?: string;
}

export class RefillWorker {
  private readonly makeId: () => string;
  private readonly leaseSeconds: number;
  private readonly maxDeliveryAttempts: number;

  constructor(
    private readonly store: StandbyStore,
    private readonly sender: OfferSender,
    private readonly options: WorkerOptions,
  ) {
    this.makeId = options.idFactory ?? randomUUID;
    this.leaseSeconds = options.leaseSeconds ?? 30;
    this.maxDeliveryAttempts = options.maxDeliveryAttempts ?? 3;
  }

  async runOnce(nowIso: string): Promise<WorkerRunResult> {
    const now = DateTime.fromISO(nowIso);
    if (!now.isValid) throw new Error(`Invalid worker timestamp: ${nowIso}`);

    await this.expireOffers(nowIso);
    const leasedJobId = await this.leaseNextJob(nowIso);
    if (leasedJobId === undefined) return { status: "idle" };

    const snapshot = await this.store.read();
    const job = snapshot.refillJobs.find((candidate) => candidate.id === leasedJobId);
    if (job === undefined) return { status: "idle" };
    const priorityCustomerId = this.options.priorityVoiceCustomerId;
    const priorityHasAnotherActiveOffer = priorityCustomerId !== undefined
      && !job.attemptedCustomerIds.includes(priorityCustomerId)
      && snapshot.offers.some((offer) => (
        offer.customerId === priorityCustomerId
        && offer.jobId !== job.id
        && ["pending", "delivered"].includes(offer.status)
      ));
    if (priorityHasAnotherActiveOffer) {
      await this.deferLeasedJob(job.id, now.plus({ seconds: 15 }).toUTC().toISO()!, nowIso);
      return { status: "idle" };
    }
    let candidates = rankRefillCandidates({
      job,
      customers: snapshot.customers,
      appointments: snapshot.appointments,
      waitlist: snapshot.waitlist,
      settings: snapshot.settings,
      now: nowIso,
    });
    const priorityCustomer = priorityCustomerId === undefined
      ? undefined
      : snapshot.customers.find((customer) => customer.id === priorityCustomerId);
    if (
      priorityCustomer !== undefined
      && priorityCustomer.phone !== undefined
      && priorityCustomer.replacementOffersEnabled !== false
      && !job.attemptedCustomerIds.includes(priorityCustomer.id)
    ) {
      const rankedPriority = candidates.find((candidate) => candidate.customerId === priorityCustomer.id);
      const priorityCandidate: RefillCandidate = rankedPriority === undefined
        ? { customerId: priorityCustomer.id, kind: "past_customer", channel: "voice" }
        : { ...rankedPriority, channel: "voice" };
      candidates = [
        priorityCandidate,
        ...candidates.filter((candidate) => candidate.customerId !== priorityCustomer.id),
      ];
    }
    const candidate = candidates[0];
    if (candidate === undefined) {
      await this.markExhausted(job.id, nowIso);
      return { status: "exhausted", jobId: job.id };
    }

    const offer = await this.createOffer(job, candidate, snapshot, nowIso);
    if (offer === undefined) return { status: "idle" };
    const delivery = this.buildDelivery(offer, snapshot);
    if (delivery === undefined) {
      await this.recordDeliveryFailure(offer.id, 0, nowIso, "Candidate context was missing.");
      return { status: "delivery_failed", offerId: offer.id, customerId: offer.customerId };
    }

    let lastError = "Provider delivery failed.";
    for (let attempt = 1; attempt <= this.maxDeliveryAttempts; attempt += 1) {
      try {
        const response = await this.sender.send(delivery);
        await this.markDelivered(offer.id, attempt, response.providerMessageId, nowIso);
        return { status: "offer_delivered", offerId: offer.id, customerId: offer.customerId };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Provider delivery failed.";
      }
    }

    await this.recordDeliveryFailure(offer.id, this.maxDeliveryAttempts, nowIso, lastError);
    return { status: "delivery_failed", offerId: offer.id, customerId: offer.customerId };
  }

  private async expireOffers(nowIso: string): Promise<void> {
    const now = DateTime.fromISO(nowIso);
    const snapshot = await this.store.read();
    const hasExpiredOffer = snapshot.offers.some((offer) => {
      if (offer.status !== "delivered" || DateTime.fromISO(offer.expiresAt).toMillis() > now.toMillis()) {
        return false;
      }
      return snapshot.refillJobs.some(
        (job) => job.id === offer.jobId
          && job.currentOfferId === offer.id
          && job.status === "awaiting_offer",
      );
    });
    if (!hasExpiredOffer) return;

    await this.store.transaction((state) => {
      for (const offer of state.offers) {
        if (offer.status !== "delivered") continue;
        const expiresAt = DateTime.fromISO(offer.expiresAt);
        if (!expiresAt.isValid || expiresAt.toMillis() > now.toMillis()) continue;
        const job = state.refillJobs.find(
          (candidate) => candidate.id === offer.jobId && candidate.currentOfferId === offer.id,
        );
        if (job === undefined || job.status !== "awaiting_offer") continue;
        offer.status = "expired";
        offer.updatedAt = nowIso;
        job.status = "pending";
        delete job.currentOfferId;
        delete job.leaseOwner;
        delete job.leaseExpiresAt;
        job.updatedAt = nowIso;
        job.version += 1;
        job.timeline.push({
          type: "offer_expired",
          at: nowIso,
          message: `The offer to ${offer.customerId} expired, so Standby continued the search.`,
          customerId: offer.customerId,
          offerId: offer.id,
        });
        state.events.push({
          id: randomUUID(),
          type: "offer.expired",
          aggregateId: offer.id,
          occurredAt: nowIso,
          data: { refillJobId: job.id },
        });
      }
    });
  }

  private async leaseNextJob(nowIso: string): Promise<string | undefined> {
    const now = DateTime.fromISO(nowIso);
    const snapshot = await this.store.read();
    if (!snapshot.refillJobs.some((job) => jobCanBeLeased(job, now))) return undefined;

    return this.store.transaction((state) => {
      const available = state.refillJobs
        .filter((job) => jobCanBeLeased(job, now))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      if (available === undefined) return undefined;
      available.status = "leased";
      available.leaseOwner = this.options.workerId;
      available.leaseExpiresAt = now.plus({ seconds: this.leaseSeconds }).toUTC().toISO()!;
      available.updatedAt = nowIso;
      available.version += 1;
      return available.id;
    });
  }

  private async deferLeasedJob(jobId: string, retryAt: string, nowIso: string): Promise<void> {
    await this.store.transaction((state) => {
      const job = state.refillJobs.find((candidate) => candidate.id === jobId);
      if (job === undefined || job.status !== "leased" || job.leaseOwner !== this.options.workerId) return;
      job.status = "pending";
      job.retryAt = retryAt;
      delete job.leaseOwner;
      delete job.leaseExpiresAt;
      job.updatedAt = nowIso;
      job.version += 1;
    });
  }

  private async markExhausted(jobId: string, nowIso: string): Promise<void> {
    await this.store.transaction((state) => {
      const job = state.refillJobs.find((candidate) => candidate.id === jobId);
      if (job === undefined || job.leaseOwner !== this.options.workerId) return;
      job.status = "exhausted";
      delete job.leaseOwner;
      delete job.leaseExpiresAt;
      job.updatedAt = nowIso;
      job.version += 1;
      job.timeline.push({
        type: "search_exhausted",
        at: nowIso,
        message: "Standby reached the end of the eligible contact list.",
      });
      state.events.push({
        id: randomUUID(),
        type: "refill.exhausted",
        aggregateId: job.id,
        occurredAt: nowIso,
      });
    });
  }

  private async createOffer(
    leasedJob: RefillJob,
    candidate: RefillCandidate,
    snapshot: StandbyState,
    nowIso: string,
  ): Promise<OutreachOffer | undefined> {
    const offerId = this.makeId();
    const expirySeconds = candidate.channel === "voice"
      ? Math.max(snapshot.settings.offerExpirySeconds, MINIMUM_VOICE_OFFER_EXPIRY_SECONDS)
      : snapshot.settings.offerExpirySeconds;
    const expiresAt = DateTime.fromISO(nowIso)
      .plus({ seconds: expirySeconds })
      .toUTC()
      .toISO()!;
    const movingAppointment = candidate.appointmentId === undefined
      ? undefined
      : snapshot.appointments.find((appointment) => appointment.id === candidate.appointmentId);
    const priorPastOffers = snapshot.offers.filter(
      (offer) => offer.jobId === leasedJob.id && offer.candidateKind === "past_customer",
    ).length;
    const discountPercent = candidate.customerId === this.options.priorityVoiceCustomerId
      ? 0
      : candidate.kind === "past_customer"
      ? calculatePastCustomerDiscount(priorPastOffers, snapshot.settings.maxDiscountPercent)
      : 0;

    return this.store.transaction((state) => {
      const job = state.refillJobs.find((item) => item.id === leasedJob.id);
      if (
        job === undefined
        || job.status !== "leased"
        || job.leaseOwner !== this.options.workerId
        || state.offers.some((item) => item.jobId === job.id && ["pending", "delivered"].includes(item.status))
      ) return undefined;

      const offer: OutreachOffer = {
        id: offerId,
        jobId: job.id,
        customerId: candidate.customerId,
        candidateKind: candidate.kind,
        channel: candidate.channel,
        status: "pending",
        proposedStartAt: job.slotStartAt,
        proposedEndAt: job.slotEndAt,
        ...(movingAppointment === undefined ? {} : {
          originalAppointmentId: movingAppointment.id,
          originalStartAt: movingAppointment.startAt,
        }),
        ...(candidate.waitlistEntryId === undefined ? {} : { waitlistEntryId: candidate.waitlistEntryId }),
        discountPercent,
        expiresAt,
        deliveryAttempts: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      state.offers.push(offer);
      job.status = "awaiting_offer";
      job.currentOfferId = offer.id;
      if (!job.attemptedCustomerIds.includes(candidate.customerId)) {
        job.attemptedCustomerIds.push(candidate.customerId);
      }
      delete job.leaseOwner;
      delete job.leaseExpiresAt;
      job.updatedAt = nowIso;
      job.version += 1;
      job.timeline.push({
        type: "offer_created",
        at: nowIso,
        message: `Standby prepared an offer for ${candidate.customerId}.`,
        customerId: candidate.customerId,
        offerId: offer.id,
      });
      state.events.push({
        id: randomUUID(),
        type: "offer.created",
        aggregateId: offer.id,
        occurredAt: nowIso,
        data: { refillJobId: job.id, customerId: candidate.customerId },
      });
      return offer;
    });
  }

  private buildDelivery(offer: OutreachOffer, state: StandbyState): OfferDelivery | undefined {
    const customer = state.customers.find((candidate) => candidate.id === offer.customerId);
    const job = state.refillJobs.find((candidate) => candidate.id === offer.jobId);
    if (customer === undefined || job === undefined) return undefined;
    const barber = state.barbers.find((candidate) => candidate.id === job.barberId);
    const service = state.services.find((candidate) => candidate.id === job.serviceId);
    if (barber === undefined || service === undefined) return undefined;
    return { offer, customer, barber, service };
  }

  private async markDelivered(
    offerId: string,
    attempts: number,
    providerMessageId: string,
    nowIso: string,
  ): Promise<void> {
    await this.store.transaction((state) => {
      const offer = state.offers.find((candidate) => candidate.id === offerId);
      if (offer === undefined || offer.status !== "pending") return;
      const job = state.refillJobs.find((candidate) => candidate.id === offer.jobId);
      offer.status = "delivered";
      offer.deliveryAttempts = attempts;
      offer.providerMessageId = providerMessageId;
      offer.updatedAt = nowIso;
      if (job !== undefined) {
        job.timeline.push({
          type: "offer_delivered",
          at: nowIso,
          message: `Standby is waiting for ${offer.customerId}.`,
          customerId: offer.customerId,
          offerId: offer.id,
        });
        job.updatedAt = nowIso;
        job.version += 1;
      }
      state.events.push({
        id: randomUUID(),
        type: "offer.delivered",
        aggregateId: offer.id,
        occurredAt: nowIso,
        data: { customerId: offer.customerId, channel: offer.channel },
      });
    });
  }

  private async recordDeliveryFailure(
    offerId: string,
    attempts: number,
    nowIso: string,
    errorMessage: string,
  ): Promise<void> {
    await this.store.transaction((state) => {
      const offer = state.offers.find((candidate) => candidate.id === offerId);
      if (offer === undefined || offer.status !== "pending") return;
      const job = state.refillJobs.find((candidate) => candidate.id === offer.jobId);
      offer.status = "delivery_failed";
      offer.deliveryAttempts = attempts;
      offer.updatedAt = nowIso;
      if (job !== undefined) {
        job.status = "pending";
        delete job.currentOfferId;
        job.error = errorMessage;
        job.updatedAt = nowIso;
        job.version += 1;
        job.timeline.push({
          type: "delivery_failed",
          at: nowIso,
          message: `Delivery to ${offer.customerId} failed after ${attempts} attempts. Standby will continue.`,
          customerId: offer.customerId,
          offerId: offer.id,
        });
      }
      state.events.push({
        id: randomUUID(),
        type: "offer.delivery_failed",
        aggregateId: offer.id,
        occurredAt: nowIso,
        data: { error: errorMessage },
      });
    });
  }
}
