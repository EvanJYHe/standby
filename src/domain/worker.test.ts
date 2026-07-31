import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { StandbyEngine } from "./engine.js";
import { InMemoryStore, type StandbyState } from "./store.js";
import type { OutreachOffer, SchedulingSettings } from "./types.js";
import { RefillWorker, type OfferDelivery, type OfferSender } from "./worker.js";

const timezone = "America/Toronto";
const slot5 = DateTime.fromISO("2026-07-20T17:00", { zone: timezone }).toUTC().toISO()!;
const slot6 = DateTime.fromISO("2026-07-20T18:00", { zone: timezone }).toUTC().toISO()!;

const settings: SchedulingSettings = {
  timezone,
  refillEnabled: true,
  moveEarlierEnabled: true,
  moveLimit: 3,
  allowAlternateBarbers: true,
  waitlistEnabled: true,
  pastCustomerOutreachEnabled: true,
  maxDiscountPercent: 15,
  offerExpirySeconds: 120,
};

function state(): StandbyState {
  return {
    customers: [
      {
        id: "josh",
        name: "Josh",
        contactPreference: "telegram",
        earlierMoveConsent: false,
        flexibleBarberPreference: false,
        pastCustomerOptIn: false,
      },
      {
        id: "sarah",
        name: "Sarah",
        phone: "+14165550101",
        contactPreference: "voice",
        earlierMoveConsent: true,
        flexibleBarberPreference: false,
        pastCustomerOptIn: true,
      },
      {
        id: "alex",
        name: "Alex",
        telegramChatId: "2002",
        contactPreference: "telegram",
        earlierMoveConsent: false,
        flexibleBarberPreference: false,
        pastCustomerOptIn: false,
      },
    ],
    barbers: [{
      id: "jeremy",
      name: "Jeremy",
      serviceIds: ["haircut"],
      weeklyHours: { 1: [{ start: "09:00", end: "20:00" }] },
    }],
    services: [{
      id: "haircut",
      name: "Signature haircut",
      durationMinutes: 60,
      priceCents: 4500,
    }],
    appointments: [
      {
        id: "josh-appt",
        customerId: "josh",
        barberId: "jeremy",
        serviceId: "haircut",
        startAt: slot5,
        endAt: slot6,
        status: "cancelled",
        discountPercent: 0,
        version: 2,
        history: [],
      },
      {
        id: "sarah-appt",
        customerId: "sarah",
        barberId: "jeremy",
        serviceId: "haircut",
        startAt: slot6,
        endAt: DateTime.fromISO(slot6).plus({ hours: 1 }).toUTC().toISO()!,
        status: "confirmed",
        discountPercent: 0,
        version: 1,
        history: [],
      },
    ],
    waitlist: [{
      id: "alex-wait",
      customerId: "alex",
      serviceId: "haircut",
      barberId: "jeremy",
      date: "2026-07-20",
      earliestStart: "17:00",
      latestStart: "19:00",
      status: "active",
      createdAt: "2026-07-19T12:00:00.000Z",
    }],
    refillJobs: [{
      id: "job-1",
      sourceAppointmentId: "josh-appt",
      barberId: "jeremy",
      serviceId: "haircut",
      slotStartAt: slot5,
      slotEndAt: slot6,
      status: "pending",
      moveDepth: 0,
      attemptedCustomerIds: [],
      timeline: [],
      version: 1,
      createdAt: "2026-07-20T15:55:00.000Z",
      updatedAt: "2026-07-20T15:55:00.000Z",
    }],
    offers: [],
    processedEvents: [],
    backboardThreads: [],
    conversations: [],
    conversationEvents: [],
    customerNotes: [],
    events: [],
    settings: structuredClone(settings),
  };
}

class DeterministicSender implements OfferSender {
  private attempts = 0;

  constructor(private readonly failuresBeforeSuccess = 0) {}

  canReach(): boolean {
    return true;
  }

  async send(_delivery: OfferDelivery): Promise<{ providerMessageId: string }> {
    this.attempts += 1;
    if (this.attempts <= this.failuresBeforeSuccess) throw new Error("provider unavailable");
    return { providerMessageId: `provider-${this.attempts}` };
  }
}

describe("RefillWorker", () => {
  it("does not emit store changes while the queue is idle", async () => {
    const initial = state();
    initial.refillJobs = [];
    const store = new InMemoryStore(initial);
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });
    const worker = new RefillWorker(store, new DeterministicSender(), {
      workerId: "idle-worker",
    });

    const result = await worker.runOnce("2026-07-20T16:00:00.000Z");

    expect(result).toEqual({ status: "idle" });
    expect(notifications).toBe(0);
  });

  it("leases a job and gives a voice recipient enough time to accept during the call", async () => {
    const store = new InMemoryStore(state());
    const worker = new RefillWorker(store, new DeterministicSender(), {
      workerId: "worker-a",
      idFactory: () => "offer-sarah",
    });

    const result = await worker.runOnce("2026-07-20T16:00:00.000Z");

    expect(result).toMatchObject({ status: "offer_delivered", customerId: "sarah" });
    const snapshot = await store.read();
    expect(snapshot.offers).toContainEqual(expect.objectContaining({
      id: "offer-sarah",
      customerId: "sarah",
      candidateKind: "move_earlier",
      channel: "voice",
      status: "delivered",
      expiresAt: "2026-07-20T16:15:00.000Z",
    }));
    expect(snapshot.refillJobs[0]).toMatchObject({
      status: "awaiting_offer",
      currentOfferId: "offer-sarah",
      attemptedCustomerIds: ["sarah"],
    });

    const accepted = await new StandbyEngine(store).respondToOffer({
      actor: { provider: "elevenlabs", customerId: "sarah" },
      offerId: "offer-sarah",
      response: "accept",
      confirmed: true,
      now: "2026-07-20T16:05:00.000Z",
    });
    expect(accepted).toMatchObject({ type: "committed", operation: "accept_offer" });
  });

  it("skips a ranked customer when their selected channel is unreachable", async () => {
    const initial = state();
    delete initial.customers.find((customer) => customer.id === "sarah")!.phone;
    const deliveries: OfferDelivery[] = [];
    const store = new InMemoryStore(initial);
    const worker = new RefillWorker(store, {
      canReach: (customer, channel) => channel === "telegram" && customer.telegramChatId !== undefined,
      send: async (delivery) => {
        deliveries.push(delivery);
        return { providerMessageId: "telegram-message" };
      },
    }, {
      workerId: "reachable-worker",
      idFactory: () => "offer-alex",
    });

    const result = await worker.runOnce("2026-07-20T16:00:00.000Z");

    expect(result).toMatchObject({ status: "offer_delivered", customerId: "alex" });
    expect(deliveries[0]).toMatchObject({
      customer: { id: "alex", telegramChatId: "2002" },
      offer: {
        customerId: "alex",
        channel: "telegram",
        candidateKind: "waitlist",
        discountPercent: 0,
      },
    });
  });

  it("defers a job when every reachable recipient already has active outreach", async () => {
    const initial = state();
    initial.refillJobs[0] = {
      ...initial.refillJobs[0]!,
      status: "awaiting_offer",
      currentOfferId: "active-sarah-offer",
      attemptedCustomerIds: ["sarah"],
    };
    initial.offers.push({
      id: "active-sarah-offer",
      jobId: "job-1",
      customerId: "sarah",
      candidateKind: "move_earlier",
      channel: "voice",
      status: "delivered",
      proposedStartAt: slot5,
      proposedEndAt: slot6,
      discountPercent: 0,
      expiresAt: "2026-07-20T16:15:00.000Z",
      deliveryAttempts: 1,
      createdAt: "2026-07-20T16:00:00.000Z",
      updatedAt: "2026-07-20T16:00:00.000Z",
    });
    const { currentOfferId: _activeOfferId, ...jobWithoutCurrentOffer } = initial.refillJobs[0]!;
    initial.refillJobs.push({
      ...jobWithoutCurrentOffer,
      id: "job-2",
      sourceAppointmentId: "another-cancelled-appointment",
      status: "pending",
      attemptedCustomerIds: ["alex"],
      createdAt: "2026-07-20T15:56:00.000Z",
      updatedAt: "2026-07-20T15:56:00.000Z",
    });
    const deliveries: OfferDelivery[] = [];
    const store = new InMemoryStore(initial);
    const worker = new RefillWorker(store, {
      canReach: () => true,
      send: async (delivery) => {
        deliveries.push(delivery);
        return { providerMessageId: "unexpected-call" };
      },
    }, {
      workerId: "busy-recipient-worker",
    });

    expect(await worker.runOnce("2026-07-20T16:01:00.000Z")).toEqual({ status: "idle" });
    const deferred = (await store.read()).refillJobs.find((job) => job.id === "job-2");
    expect(deferred).toMatchObject({
      status: "pending",
      retryAt: "2026-07-20T16:01:15.000Z",
      attemptedCustomerIds: ["alex"],
    });
    expect(deliveries).toHaveLength(0);
  });

  it("retries idempotent message delivery before exposing a successful offer", async () => {
    const initial = state();
    initial.customers.find((customer) => customer.id === "sarah")!.earlierMoveConsent = false;
    const store = new InMemoryStore(initial);
    const worker = new RefillWorker(store, new DeterministicSender(2), {
      workerId: "worker-a",
      idFactory: () => "offer-alex",
      maxDeliveryAttempts: 3,
    });

    await worker.runOnce("2026-07-20T16:00:00.000Z");

    expect((await store.read()).offers[0]).toMatchObject({
      status: "delivered",
      deliveryAttempts: 3,
      providerMessageId: "provider-3",
    });
  });

  it("does not blindly retry voice initiation after an ambiguous provider failure", async () => {
    const store = new InMemoryStore(state());
    const worker = new RefillWorker(store, new DeterministicSender(99), {
      workerId: "worker-a",
      idFactory: () => "offer-sarah",
      maxDeliveryAttempts: 3,
    });

    const result = await worker.runOnce("2026-07-20T16:00:00.000Z");

    expect(result).toMatchObject({ status: "delivery_uncertain" });
    const snapshot = await store.read();
    expect(snapshot.offers[0]).toMatchObject({ status: "pending", deliveryAttempts: 1 });
    expect(snapshot.refillJobs[0]).toMatchObject({
      status: "awaiting_offer",
      currentOfferId: "offer-sarah",
    });
    expect(snapshot.refillJobs[0]?.timeline).toContainEqual(
      expect.objectContaining({ type: "delivery_uncertain" }),
    );

    const recoveryWorker = new RefillWorker(store, new DeterministicSender(), {
      workerId: "worker-b",
      idFactory: () => "offer-alex",
    });
    await expect(recoveryWorker.runOnce("2026-07-20T16:16:00.000Z"))
      .resolves.toMatchObject({ status: "offer_delivered", customerId: "alex" });
    const recovered = await store.read();
    expect(recovered.offers.find((offer) => offer.id === "offer-sarah")?.status).toBe("expired");
  });

  it("enforces one active outreach per customer across concurrent jobs", async () => {
    const initial = state();
    initial.appointments.push({
      ...initial.appointments[0]!,
      id: "second-cancelled-appointment",
      startAt: DateTime.fromISO(slot5).plus({ days: 1 }).toUTC().toISO()!,
      endAt: DateTime.fromISO(slot6).plus({ days: 1 }).toUTC().toISO()!,
    });
    initial.refillJobs.push({
      ...initial.refillJobs[0]!,
      id: "job-2",
      sourceAppointmentId: "second-cancelled-appointment",
      slotStartAt: DateTime.fromISO(slot5).plus({ days: 1 }).toUTC().toISO()!,
      slotEndAt: DateTime.fromISO(slot6).plus({ days: 1 }).toUTC().toISO()!,
    });
    const store = new InMemoryStore(initial);
    const deliveries: OfferDelivery[] = [];
    const sender: OfferSender = {
      canReach: () => true,
      send: async (delivery) => {
        deliveries.push(delivery);
        return { providerMessageId: `provider-${delivery.offer.id}` };
      },
    };
    const workerA = new RefillWorker(store, sender, {
      workerId: "worker-a",
      idFactory: () => "offer-a",
    });
    const workerB = new RefillWorker(store, sender, {
      workerId: "worker-b",
      idFactory: () => "offer-b",
    });

    await Promise.all([
      workerA.runOnce("2026-07-20T16:00:00.000Z"),
      workerB.runOnce("2026-07-20T16:00:00.000Z"),
    ]);

    const snapshot = await store.read();
    expect(snapshot.offers.filter((offer) => (
      offer.customerId === "sarah" && ["pending", "delivered"].includes(offer.status)
    ))).toHaveLength(1);
    expect(deliveries.filter((delivery) => delivery.customer.id === "sarah")).toHaveLength(1);
  });

  it("expires an unanswered offer and advances to the next sequential candidate", async () => {
    const initial = state();
    initial.refillJobs[0] = {
      ...initial.refillJobs[0]!,
      status: "awaiting_offer",
      currentOfferId: "offer-sarah",
      attemptedCustomerIds: ["sarah"],
    };
    const expired: OutreachOffer = {
      id: "offer-sarah",
      jobId: "job-1",
      customerId: "sarah",
      candidateKind: "move_earlier",
      channel: "voice",
      status: "delivered",
      proposedStartAt: slot5,
      proposedEndAt: slot6,
      originalAppointmentId: "sarah-appt",
      originalStartAt: slot6,
      discountPercent: 0,
      expiresAt: "2026-07-20T16:02:00.000Z",
      deliveryAttempts: 1,
      createdAt: "2026-07-20T16:00:00.000Z",
      updatedAt: "2026-07-20T16:00:00.000Z",
    };
    initial.offers.push(expired);
    const store = new InMemoryStore(initial);
    const worker = new RefillWorker(store, new DeterministicSender(), {
      workerId: "worker-b",
      idFactory: () => "offer-alex",
    });

    const result = await worker.runOnce("2026-07-20T16:03:00.000Z");

    expect(result).toMatchObject({ status: "offer_delivered", customerId: "alex" });
    const snapshot = await store.read();
    expect(snapshot.offers.find((item) => item.id === "offer-sarah")).toMatchObject({ status: "expired" });
    expect(snapshot.offers.find((item) => item.id === "offer-alex")).toMatchObject({
      candidateKind: "waitlist",
      customerId: "alex",
      status: "delivered",
    });
  });

  it("recovers a lease left behind by a stopped worker", async () => {
    const initial = state();
    initial.refillJobs[0] = {
      ...initial.refillJobs[0]!,
      status: "leased",
      leaseOwner: "stopped-worker",
      leaseExpiresAt: "2026-07-20T15:59:00.000Z",
    };
    const store = new InMemoryStore(initial);
    const worker = new RefillWorker(store, new DeterministicSender(), {
      workerId: "replacement-worker",
      idFactory: () => "offer-recovered",
    });

    const result = await worker.runOnce("2026-07-20T16:00:00.000Z");

    expect(result).toMatchObject({ status: "offer_delivered", customerId: "sarah" });
    expect((await store.read()).refillJobs[0]?.leaseOwner).toBeUndefined();
  });
});
