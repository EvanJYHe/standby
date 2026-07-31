import { DateTime } from "luxon";
import { beforeEach, describe, expect, it } from "vitest";

import { StandbyEngine } from "./engine.js";
import { InMemoryStore, type StandbyState } from "./store.js";
import type {
  Appointment,
  Barber,
  Customer,
  OutreachOffer,
  RefillJob,
  SchedulingSettings,
  Service,
} from "./types.js";

const timezone = "America/Toronto";
const slot5 = DateTime.fromISO("2026-07-20T17:00", { zone: timezone }).toUTC().toISO()!;
const slot6 = DateTime.fromISO("2026-07-20T18:00", { zone: timezone }).toUTC().toISO()!;
const slot7 = DateTime.fromISO("2026-07-20T19:00", { zone: timezone }).toUTC().toISO()!;

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
const service: Service = {
  id: "haircut",
  name: "Signature haircut",
  durationMinutes: 60,
  priceCents: 4500,
};
const barber: Barber = {
  id: "jeremy",
  name: "Jeremy",
  serviceIds: [service.id],
  weeklyHours: {
    1: [{ start: "09:00", end: "20:00" }],
  },
};
const customers: Customer[] = [
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
    contactPreference: "voice",
    earlierMoveConsent: true,
    flexibleBarberPreference: false,
    pastCustomerOptIn: true,
  },
  {
    id: "alex",
    name: "Alex",
    contactPreference: "telegram",
    earlierMoveConsent: false,
    flexibleBarberPreference: false,
    pastCustomerOptIn: false,
  },
];

function appointment(id: string, customerId: string, startAt: string): Appointment {
  return {
    id,
    customerId,
    barberId: barber.id,
    serviceId: service.id,
    startAt,
    endAt: DateTime.fromISO(startAt).plus({ hours: 1 }).toUTC().toISO()!,
    status: "confirmed",
    discountPercent: 0,
    version: 1,
    history: [],
  };
}

function baseState(): StandbyState {
  return {
    customers: structuredClone(customers),
    barbers: [structuredClone(barber)],
    services: [structuredClone(service)],
    appointments: [
      appointment("josh-appt", "josh", slot5),
      appointment("sarah-appt", "sarah", slot6),
    ],
    waitlist: [{
      id: "alex-wait",
      customerId: "alex",
      serviceId: service.id,
      barberId: barber.id,
      date: "2026-07-20",
      earliestStart: "17:00",
      latestStart: "19:00",
      status: "active",
      createdAt: "2026-07-19T12:00:00.000Z",
    }],
    refillJobs: [],
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

function job(overrides: Partial<RefillJob> = {}): RefillJob {
  return {
    id: "job-1",
    sourceAppointmentId: "josh-appt",
    barberId: barber.id,
    serviceId: service.id,
    slotStartAt: slot5,
    slotEndAt: slot6,
    status: "awaiting_offer",
    moveDepth: 0,
    attemptedCustomerIds: ["sarah"],
    currentOfferId: "offer-sarah",
    timeline: [],
    version: 1,
    createdAt: "2026-07-20T16:00:00.000Z",
    updatedAt: "2026-07-20T16:00:00.000Z",
    ...overrides,
  };
}

function offer(overrides: Partial<OutreachOffer> = {}): OutreachOffer {
  return {
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
    expiresAt: "2026-07-20T16:05:00.000Z",
    deliveryAttempts: 1,
    createdAt: "2026-07-20T16:00:00.000Z",
    updatedAt: "2026-07-20T16:00:00.000Z",
    ...overrides,
  };
}

describe("StandbyEngine", () => {
  let store: InMemoryStore;
  let ids: string[];
  let engine: StandbyEngine;

  beforeEach(() => {
    store = new InMemoryStore(baseState());
    ids = ["generated-appointment", "generated-job", "generated-event"];
    engine = new StandbyEngine(store, { idFactory: () => ids.shift() ?? "fallback-id" });
  });

  it("requires confirmation before booking and commits only while the slot is still open", async () => {
    const proposed = await engine.book({
      actor: { provider: "telegram", customerId: "alex" },
      customerId: "alex",
      barberId: "jeremy",
      serviceId: "haircut",
      startAt: slot7,
      confirmed: false,
      now: "2026-07-20T15:00:00.000Z",
    });
    expect(proposed).toMatchObject({ type: "confirmation_required", operation: "book" });
    expect((await store.read()).appointments).toHaveLength(2);

    const booked = await engine.book({
      actor: { provider: "telegram", customerId: "alex" },
      customerId: "alex",
      barberId: "jeremy",
      serviceId: "haircut",
      startAt: slot7,
      confirmed: true,
      now: "2026-07-20T15:01:00.000Z",
    });
    expect(booked).toMatchObject({ type: "committed", operation: "book" });
    expect((await store.read()).appointments).toContainEqual(
      expect.objectContaining({ customerId: "alex", startAt: slot7, status: "confirmed" }),
    );

    const stale = await engine.book({
      actor: { provider: "telegram", customerId: "josh" },
      customerId: "josh",
      barberId: "jeremy",
      serviceId: "haircut",
      startAt: slot7,
      confirmed: true,
      now: "2026-07-20T15:02:00.000Z",
    });
    expect(stale).toMatchObject({ type: "conflict", code: "STALE_SLOT" });
  });

  it("turns a direct cancellation into an exact refill job with consent history", async () => {
    const result = await engine.cancel({
      actor: { provider: "telegram", customerId: "josh" },
      appointmentId: "josh-appt",
      now: "2026-07-20T16:00:00.000Z",
    });

    expect(result).toMatchObject({ type: "committed", operation: "cancel" });
    const state = await store.read();
    expect(state.appointments.find((item) => item.id === "josh-appt")).toMatchObject({
      status: "cancelled",
      history: [expect.objectContaining({ type: "cancelled", consent: "direct_cancellation" })],
    });
    expect(state.refillJobs).toContainEqual(expect.objectContaining({
      sourceAppointmentId: "josh-appt",
      barberId: "jeremy",
      serviceId: "haircut",
      slotStartAt: slot5,
      status: "pending",
      moveDepth: 0,
    }));
  });

  it("requires confirmation before rescheduling and rejects an occupied target", async () => {
    const proposed = await engine.reschedule({
      actor: { provider: "elevenlabs", customerId: "sarah" },
      appointmentId: "sarah-appt",
      barberId: "jeremy",
      startAt: slot7,
      confirmed: false,
      now: "2026-07-20T15:00:00.000Z",
    });
    expect(proposed).toMatchObject({ type: "confirmation_required", operation: "reschedule" });

    const occupied = await engine.reschedule({
      actor: { provider: "elevenlabs", customerId: "sarah" },
      appointmentId: "sarah-appt",
      barberId: "jeremy",
      startAt: slot5,
      confirmed: true,
      now: "2026-07-20T15:01:00.000Z",
    });
    expect(occupied).toMatchObject({ type: "conflict", code: "STALE_SLOT" });
  });

  it("moves a consented appointment atomically and creates a successor refill job", async () => {
    await store.transaction((state) => {
      state.appointments.find((item) => item.id === "josh-appt")!.status = "cancelled";
      state.refillJobs.push(job());
      state.offers.push(offer());
    });

    const proposed = await engine.respondToOffer({
      actor: { provider: "elevenlabs", customerId: "sarah" },
      offerId: "offer-sarah",
      response: "accept",
      confirmed: false,
      now: "2026-07-20T16:01:00.000Z",
    });
    expect(proposed).toMatchObject({ type: "confirmation_required", operation: "accept_offer" });

    const accepted = await engine.respondToOffer({
      actor: { provider: "elevenlabs", customerId: "sarah" },
      offerId: "offer-sarah",
      response: "accept",
      confirmed: true,
      now: "2026-07-20T16:01:10.000Z",
    });
    expect(accepted).toMatchObject({ type: "committed", operation: "accept_offer" });

    const state = await store.read();
    expect(state.appointments.find((item) => item.id === "sarah-appt")).toMatchObject({
      startAt: slot5,
      endAt: slot6,
      version: 2,
      history: [expect.objectContaining({
        type: "moved_earlier",
        fromStartAt: slot6,
        toStartAt: slot5,
        offerId: "offer-sarah",
      })],
    });
    expect(state.refillJobs.find((item) => item.id === "job-1")).toMatchObject({ status: "completed" });
    expect(state.refillJobs).toContainEqual(expect.objectContaining({
      slotStartAt: slot6,
      slotEndAt: slot7,
      moveDepth: 1,
      status: "pending",
      sourceAppointmentId: "sarah-appt",
    }));
  });

  it("allows only one simultaneous acceptance to claim an opening", async () => {
    await store.transaction((state) => {
      state.appointments.find((item) => item.id === "josh-appt")!.status = "cancelled";
      state.refillJobs.push(job({ currentOfferId: "offer-a" }));
      const alexOffer = offer({
          id: "offer-a",
          customerId: "alex",
          candidateKind: "waitlist",
          channel: "telegram",
          waitlistEntryId: "alex-wait",
        });
      delete alexOffer.originalAppointmentId;
      delete alexOffer.originalStartAt;
      const sarahOffer = offer({
          id: "offer-b",
          customerId: "sarah",
          candidateKind: "past_customer",
          channel: "voice",
        });
      delete sarahOffer.originalAppointmentId;
      delete sarahOffer.originalStartAt;
      state.offers.push(alexOffer, sarahOffer);
    });

    const [first, second] = await Promise.all([
      engine.respondToOffer({
        actor: { provider: "telegram", customerId: "alex" },
        offerId: "offer-a",
        response: "accept",
        confirmed: true,
        now: "2026-07-20T16:01:00.000Z",
      }),
      engine.respondToOffer({
        actor: { provider: "elevenlabs", customerId: "sarah" },
        offerId: "offer-b",
        response: "accept",
        confirmed: true,
        now: "2026-07-20T16:01:00.000Z",
      }),
    ]);

    expect([first.type, second.type].sort()).toEqual(["committed", "conflict"]);
    const atFive = (await store.read()).appointments.filter(
      (item) => item.status === "confirmed" && item.barberId === "jeremy" && item.startAt === slot5,
    );
    expect(atFive).toHaveLength(1);
  });
});
