import { randomUUID } from "node:crypto";

import { DateTime, Interval } from "luxon";

import { SHOP_CLOSED_MESSAGE } from "./shop-hours.js";
import type { StandbyState, StandbyStore } from "./store.js";
import type {
  ActorContext,
  Appointment,
  AppointmentHistoryEvent,
  CalendarEvent,
  OutreachOffer,
  RefillJob,
  Service,
  TimelineEvent,
} from "./types.js";

export type OperationName =
  | "book"
  | "cancel"
  | "reschedule"
  | "accept_offer"
  | "decline_offer";

export type OperationResult =
  | {
      type: "committed";
      operation: OperationName;
      message: string;
      appointmentId?: string;
      refillJobId?: string;
      offerId?: string;
    }
  | {
      type: "confirmation_required";
      operation: OperationName;
      message: string;
    }
  | {
      type: "conflict";
      code: "STALE_SLOT" | "STALE_OFFER";
      message: string;
    }
  | {
      type: "error";
      code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_REQUEST" | "OFFER_EXPIRED";
      message: string;
    };

interface EngineOptions {
  idFactory?: () => string;
}

interface BookInput {
  actor: ActorContext;
  customerId: string;
  barberId: string;
  serviceId: string;
  startAt: string;
  confirmed: boolean;
  now: string;
}

interface CancelInput {
  actor: ActorContext;
  appointmentId: string;
  now: string;
}

interface RescheduleInput {
  actor: ActorContext;
  appointmentId: string;
  barberId: string;
  startAt: string;
  confirmed: boolean;
  now: string;
}

interface OfferResponseInput {
  actor: ActorContext;
  offerId: string;
  response: "accept" | "decline";
  confirmed: boolean;
  now: string;
}

function resultError(code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_REQUEST" | "OFFER_EXPIRED", message: string): OperationResult {
  return { type: "error", code, message };
}

function parseDate(value: string): DateTime | undefined {
  const parsed = DateTime.fromISO(value);
  return parsed.isValid ? parsed : undefined;
}

function appointmentEnd(startAt: string, service: Service): string | undefined {
  return parseDate(startAt)?.plus({ minutes: service.durationMinutes }).toUTC().toISO() ?? undefined;
}

function isAuthorized(actor: ActorContext, customerId: string): boolean {
  return actor.provider === "admin" || actor.customerId === customerId;
}

function slotIsOpen(
  state: StandbyState,
  barberId: string,
  startAt: string,
  endAt: string,
  excludingAppointmentId?: string,
): boolean {
  const proposedStart = parseDate(startAt);
  const proposedEnd = parseDate(endAt);
  if (proposedStart === undefined || proposedEnd === undefined) return false;

  return !state.appointments.some((appointment) => {
    if (
      appointment.status !== "confirmed"
      || appointment.barberId !== barberId
      || appointment.id === excludingAppointmentId
    ) return false;
    const existingStart = parseDate(appointment.startAt);
    const existingEnd = parseDate(appointment.endAt);
    if (existingStart === undefined || existingEnd === undefined) return true;
    return Interval.fromDateTimes(proposedStart, proposedEnd).overlaps(
      Interval.fromDateTimes(existingStart, existingEnd),
    );
  });
}

function isWithinWorkingHours(
  state: StandbyState,
  barberId: string,
  serviceId: string,
  startAt: string,
  endAt: string,
): boolean {
  const barber = state.barbers.find((candidate) => candidate.id === barberId);
  if (barber === undefined || !barber.serviceIds.includes(serviceId)) return false;
  const start = parseDate(startAt)?.setZone(state.settings.timezone);
  const end = parseDate(endAt)?.setZone(state.settings.timezone);
  if (start === undefined || end === undefined || start.toISODate() !== end.toISODate()) return false;
  const ranges = barber.weeklyHours[start.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7] ?? [];
  const startTime = start.toFormat("HH:mm");
  const endTime = end.toFormat("HH:mm");
  return ranges.some((range) => startTime >= range.start && endTime <= range.end);
}

export class StandbyEngine {
  private readonly makeId: () => string;

  constructor(
    private readonly store: StandbyStore,
    options: EngineOptions = {},
  ) {
    this.makeId = options.idFactory ?? randomUUID;
  }

  async book(input: BookInput): Promise<OperationResult> {
    const state = await this.store.read();
    const customer = state.customers.find((candidate) => candidate.id === input.customerId);
    const service = state.services.find((candidate) => candidate.id === input.serviceId);
    if (customer === undefined || service === undefined) {
      return resultError("NOT_FOUND", "The customer or service could not be found.");
    }
    if (!isAuthorized(input.actor, input.customerId)) {
      return resultError("FORBIDDEN", "This request is not authorized for that customer.");
    }
    const endAt = appointmentEnd(input.startAt, service);
    if (endAt === undefined || !isWithinWorkingHours(state, input.barberId, input.serviceId, input.startAt, endAt)) {
      return resultError("INVALID_REQUEST", SHOP_CLOSED_MESSAGE);
    }
    if (!slotIsOpen(state, input.barberId, input.startAt, endAt)) {
      return { type: "conflict", code: "STALE_SLOT", message: "That time was just taken. Please choose another opening." };
    }
    if (!input.confirmed) {
      return {
        type: "confirmation_required",
        operation: "book",
        message: `Please confirm the ${service.name} appointment before I book it.`,
      };
    }

    return this.store.transaction((draft) => {
      if (!slotIsOpen(draft, input.barberId, input.startAt, endAt)) {
        return { type: "conflict", code: "STALE_SLOT", message: "That time was just taken. Please choose another opening." } satisfies OperationResult;
      }
      const appointmentId = this.makeId();
      const history: AppointmentHistoryEvent = {
        type: "booked",
        actor: input.actor.provider,
        consent: "explicit",
        createdAt: input.now,
        toStartAt: input.startAt,
      };
      draft.appointments.push({
        id: appointmentId,
        customerId: input.customerId,
        barberId: input.barberId,
        serviceId: input.serviceId,
        startAt: input.startAt,
        endAt,
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [history],
        createdAt: input.now,
        updatedAt: input.now,
      });
      this.emit(draft, "appointment.booked", appointmentId, input.now);
      return {
        type: "committed",
        operation: "book",
        message: "Your appointment is confirmed.",
        appointmentId,
      } satisfies OperationResult;
    });
  }

  async cancel(input: CancelInput): Promise<OperationResult> {
    const initial = await this.store.read();
    const appointment = initial.appointments.find((candidate) => candidate.id === input.appointmentId);
    if (appointment === undefined) return resultError("NOT_FOUND", "That appointment could not be found.");
    if (!isAuthorized(input.actor, appointment.customerId)) {
      return resultError("FORBIDDEN", "This request is not authorized for that appointment.");
    }

    return this.store.transaction((state) => {
      const target = state.appointments.find((candidate) => candidate.id === input.appointmentId);
      if (target === undefined) return resultError("NOT_FOUND", "That appointment could not be found.");
      if (target.status === "cancelled") {
        const existingJob = state.refillJobs.find((candidate) => candidate.sourceAppointmentId === target.id);
        return {
          type: "committed",
          operation: "cancel",
          message: "That appointment was already cancelled.",
          appointmentId: target.id,
          ...(existingJob === undefined ? {} : { refillJobId: existingJob.id }),
        } satisfies OperationResult;
      }

      target.status = "cancelled";
      target.version += 1;
      target.updatedAt = input.now;
      target.history.push({
        type: "cancelled",
        actor: input.actor.provider,
        consent: "direct_cancellation",
        createdAt: input.now,
        fromStartAt: target.startAt,
      });

      let refillJob: RefillJob | undefined;
      if (state.settings.refillEnabled) {
        refillJob = this.newRefillJob(target, 0, input.now);
        state.refillJobs.push(refillJob);
      }
      this.emit(state, "appointment.cancelled", target.id, input.now, {
        refillJobId: refillJob?.id,
      });
      return {
        type: "committed",
        operation: "cancel",
        message: refillJob === undefined
          ? "Your appointment has been cancelled."
          : "Your appointment has been cancelled, and Standby is finding someone for the opening.",
        appointmentId: target.id,
        ...(refillJob === undefined ? {} : { refillJobId: refillJob.id }),
      } satisfies OperationResult;
    });
  }

  async reschedule(input: RescheduleInput): Promise<OperationResult> {
    const state = await this.store.read();
    const appointment = state.appointments.find((candidate) => candidate.id === input.appointmentId);
    if (appointment === undefined || appointment.status !== "confirmed") {
      return resultError("NOT_FOUND", "That confirmed appointment could not be found.");
    }
    if (!isAuthorized(input.actor, appointment.customerId)) {
      return resultError("FORBIDDEN", "This request is not authorized for that appointment.");
    }
    const service = state.services.find((candidate) => candidate.id === appointment.serviceId);
    if (service === undefined) return resultError("NOT_FOUND", "That service could not be found.");
    const endAt = appointmentEnd(input.startAt, service);
    if (endAt === undefined || !isWithinWorkingHours(state, input.barberId, appointment.serviceId, input.startAt, endAt)) {
      return resultError("INVALID_REQUEST", SHOP_CLOSED_MESSAGE);
    }
    if (!slotIsOpen(state, input.barberId, input.startAt, endAt, appointment.id)) {
      return { type: "conflict", code: "STALE_SLOT", message: "That time was just taken. Please choose another opening." };
    }
    if (!input.confirmed) {
      return {
        type: "confirmation_required",
        operation: "reschedule",
        message: "Please confirm the new time before I move your appointment.",
      };
    }

    return this.store.transaction((draft) => {
      const target = draft.appointments.find((candidate) => candidate.id === appointment.id);
      if (
        target === undefined
        || target.status !== "confirmed"
        || !slotIsOpen(draft, input.barberId, input.startAt, endAt, target.id)
      ) {
        return { type: "conflict", code: "STALE_SLOT", message: "That time is no longer available." } satisfies OperationResult;
      }
      const oldStartAt = target.startAt;
      target.barberId = input.barberId;
      target.startAt = input.startAt;
      target.endAt = endAt;
      target.version += 1;
      target.updatedAt = input.now;
      target.history.push({
        type: "rescheduled",
        actor: input.actor.provider,
        consent: "explicit",
        createdAt: input.now,
        fromStartAt: oldStartAt,
        toStartAt: input.startAt,
      });
      this.emit(draft, "appointment.rescheduled", target.id, input.now);
      return {
        type: "committed",
        operation: "reschedule",
        message: "Your appointment has been moved.",
        appointmentId: target.id,
      } satisfies OperationResult;
    });
  }

  async respondToOffer(input: OfferResponseInput): Promise<OperationResult> {
    const initial = await this.store.read();
    const offer = initial.offers.find((candidate) => candidate.id === input.offerId);
    if (offer === undefined) return resultError("NOT_FOUND", "That offer could not be found.");
    if (!isAuthorized(input.actor, offer.customerId)) {
      return resultError("FORBIDDEN", "This offer belongs to another customer.");
    }

    if (input.response === "accept" && !input.confirmed) {
      return {
        type: "confirmation_required",
        operation: "accept_offer",
        message: "Please clearly confirm that you want this earlier appointment.",
      };
    }

    return this.store.transaction((state) => {
      const targetOffer = state.offers.find((candidate) => candidate.id === input.offerId);
      if (targetOffer === undefined) return resultError("NOT_FOUND", "That offer could not be found.");
      const refillJob = state.refillJobs.find((candidate) => candidate.id === targetOffer.jobId);
      if (refillJob === undefined) return resultError("NOT_FOUND", "That opening could not be found.");
      if (
        refillJob.status === "completed"
        || refillJob.currentOfferId !== targetOffer.id
        || !["pending", "delivered"].includes(targetOffer.status)
      ) {
        return { type: "conflict", code: "STALE_OFFER", message: "That opening is no longer available." } satisfies OperationResult;
      }
      const now = parseDate(input.now);
      const expiresAt = parseDate(targetOffer.expiresAt);
      if (now === undefined || expiresAt === undefined) {
        return resultError("INVALID_REQUEST", "The offer timing was invalid.");
      }
      if (now.toMillis() > expiresAt.toMillis()) {
        targetOffer.status = "expired";
        targetOffer.updatedAt = input.now;
        refillJob.status = "pending";
        delete refillJob.currentOfferId;
        refillJob.updatedAt = input.now;
        this.addTimeline(refillJob, "offer_expired", input.now, "The offer expired before it was accepted.", targetOffer);
        return resultError("OFFER_EXPIRED", "That offer has expired, so the opening is being offered to someone else.");
      }

      if (input.response === "decline") {
        targetOffer.status = "declined";
        targetOffer.updatedAt = input.now;
        refillJob.status = "pending";
        delete refillJob.currentOfferId;
        refillJob.updatedAt = input.now;
        refillJob.version += 1;
        this.addTimeline(refillJob, "offer_declined", input.now, "The customer declined the opening.", targetOffer);
        this.emit(state, "offer.declined", targetOffer.id, input.now, { refillJobId: refillJob.id });
        return {
          type: "committed",
          operation: "decline_offer",
          message: "Thanks for letting us know. We'll offer the opening to someone else.",
          offerId: targetOffer.id,
          refillJobId: refillJob.id,
        } satisfies OperationResult;
      }

      if (!slotIsOpen(state, refillJob.barberId, refillJob.slotStartAt, refillJob.slotEndAt)) {
        return { type: "conflict", code: "STALE_SLOT", message: "That opening was just filled." } satisfies OperationResult;
      }

      let appointmentId: string;
      if (targetOffer.candidateKind === "move_earlier") {
        const movingAppointment = state.appointments.find(
          (candidate) => candidate.id === targetOffer.originalAppointmentId,
        );
        if (
          movingAppointment === undefined
          || movingAppointment.status !== "confirmed"
          || movingAppointment.customerId !== targetOffer.customerId
          || movingAppointment.startAt !== targetOffer.originalStartAt
        ) {
          return { type: "conflict", code: "STALE_OFFER", message: "The original appointment changed, so this offer is no longer valid." } satisfies OperationResult;
        }
        const originalStartAt = movingAppointment.startAt;
        const originalEndAt = movingAppointment.endAt;
        movingAppointment.startAt = refillJob.slotStartAt;
        movingAppointment.endAt = refillJob.slotEndAt;
        movingAppointment.version += 1;
        movingAppointment.updatedAt = input.now;
        movingAppointment.history.push({
          type: "moved_earlier",
          actor: input.actor.provider,
          consent: "explicit",
          createdAt: input.now,
          fromStartAt: originalStartAt,
          toStartAt: refillJob.slotStartAt,
          offerId: targetOffer.id,
        });
        appointmentId = movingAppointment.id;

        const successor: RefillJob = {
          id: this.makeId(),
          sourceAppointmentId: movingAppointment.id,
          barberId: movingAppointment.barberId,
          serviceId: movingAppointment.serviceId,
          slotStartAt: originalStartAt,
          slotEndAt: originalEndAt,
          status: "pending",
          moveDepth: refillJob.moveDepth + 1,
          attemptedCustomerIds: [],
          timeline: [{
            type: "opening_created",
            at: input.now,
            message: `${targetOffer.customerId}'s move opened the next appointment time.`,
          }],
          version: 1,
          createdAt: input.now,
          updatedAt: input.now,
        };
        state.refillJobs.push(successor);
        this.addTimeline(refillJob, "appointment_moved", input.now, "The customer accepted and moved into this opening.", targetOffer);
      } else {
        appointmentId = this.makeId();
        state.appointments.push({
          id: appointmentId,
          customerId: targetOffer.customerId,
          barberId: refillJob.barberId,
          serviceId: refillJob.serviceId,
          startAt: refillJob.slotStartAt,
          endAt: refillJob.slotEndAt,
          status: "confirmed",
          discountPercent: targetOffer.discountPercent,
          version: 1,
          history: [{
            type: "booked",
            actor: input.actor.provider,
            consent: "explicit",
            createdAt: input.now,
            toStartAt: refillJob.slotStartAt,
            offerId: targetOffer.id,
          }],
          createdAt: input.now,
          updatedAt: input.now,
        });
        if (targetOffer.waitlistEntryId !== undefined) {
          const waitlistEntry = state.waitlist.find((candidate) => candidate.id === targetOffer.waitlistEntryId);
          if (waitlistEntry !== undefined) {
            waitlistEntry.status = "fulfilled";
            waitlistEntry.updatedAt = input.now;
          }
        }
        this.addTimeline(refillJob, "opening_filled", input.now, "The customer accepted and filled the opening.", targetOffer);
      }

      targetOffer.status = "accepted";
      targetOffer.updatedAt = input.now;
      refillJob.status = "completed";
      refillJob.updatedAt = input.now;
      refillJob.version += 1;
      this.emit(state, "offer.accepted", targetOffer.id, input.now, {
        appointmentId,
        refillJobId: refillJob.id,
      });
      return {
        type: "committed",
        operation: "accept_offer",
        message: "You're confirmed for the opening.",
        appointmentId,
        offerId: targetOffer.id,
        refillJobId: refillJob.id,
      } satisfies OperationResult;
    });
  }

  private newRefillJob(appointment: Appointment, moveDepth: number, now: string): RefillJob {
    return {
      id: this.makeId(),
      sourceAppointmentId: appointment.id,
      barberId: appointment.barberId,
      serviceId: appointment.serviceId,
      slotStartAt: appointment.startAt,
      slotEndAt: appointment.endAt,
      status: "pending",
      moveDepth,
      attemptedCustomerIds: [],
      timeline: [{
        type: "opening_created",
        at: now,
        message: "The appointment was cancelled. Standby started looking for a replacement.",
      }],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  private addTimeline(
    job: RefillJob,
    type: TimelineEvent["type"],
    at: string,
    message: string,
    offer: OutreachOffer,
  ): void {
    job.timeline.push({ type, at, message, customerId: offer.customerId, offerId: offer.id });
  }

  private emit(
    state: StandbyState,
    type: string,
    aggregateId: string,
    occurredAt: string,
    data?: Record<string, unknown>,
  ): void {
    const event: CalendarEvent = {
      id: this.makeId(),
      type,
      aggregateId,
      occurredAt,
      ...(data === undefined ? {} : { data }),
    };
    state.events.push(event);
  }
}
