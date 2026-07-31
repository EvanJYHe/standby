import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  calculatePastCustomerDiscount,
  findAvailableSlots,
  rankRefillCandidates,
} from "./scheduling.js";
import type {
  Appointment,
  Barber,
  Customer,
  RefillJob,
  SchedulingSettings,
  Service,
  WaitlistEntry,
} from "./types.js";

const zone = "America/Toronto";
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
    2: [{ start: "09:00", end: "20:00" }],
    3: [{ start: "09:00", end: "20:00" }],
    4: [{ start: "09:00", end: "20:00" }],
    5: [{ start: "09:00", end: "20:00" }],
    6: [{ start: "09:00", end: "20:00" }],
  },
};
const settings: SchedulingSettings = {
  timezone: zone,
  refillEnabled: true,
  moveEarlierEnabled: true,
  moveLimit: 3,
  allowAlternateBarbers: true,
  waitlistEnabled: true,
  pastCustomerOutreachEnabled: true,
  maxDiscountPercent: 15,
  offerExpirySeconds: 120,
};

function customer(overrides: Partial<Customer> & Pick<Customer, "id" | "name">): Customer {
  return {
    contactPreference: "telegram",
    earlierMoveConsent: false,
    flexibleBarberPreference: false,
    pastCustomerOptIn: false,
    ...overrides,
  };
}

function appointment(overrides: Partial<Appointment> & Pick<Appointment, "id" | "customerId" | "startAt">): Appointment {
  return {
    barberId: barber.id,
    serviceId: service.id,
    endAt: DateTime.fromISO(overrides.startAt, { zone }).plus({ hours: 1 }).toUTC().toISO()!,
    status: "confirmed",
    discountPercent: 0,
    version: 1,
    history: [],
    ...overrides,
  };
}

describe("findAvailableSlots", () => {
  it("returns qualified working-hour slots and excludes confirmed appointments", () => {
    const date = "2026-07-20";
    const booked = appointment({
      id: "a1",
      customerId: "josh",
      startAt: DateTime.fromISO(`${date}T17:00`, { zone }).toUTC().toISO()!,
    });

    const slots = findAvailableSlots({
      date,
      timezone: zone,
      service,
      barbers: [barber],
      appointments: [booked],
      intervalMinutes: 60,
    });

    expect(slots.some((slot) => slot.startAt === booked.startAt)).toBe(false);
    expect(slots[0]).toMatchObject({ barberId: barber.id });
    expect(slots).toHaveLength(10);
  });

  it("can return alternate qualified barbers when a requested barber is unavailable", () => {
    const alternate = { ...barber, id: "maya", name: "Maya" };
    const date = "2026-07-20";
    const requestedStart = DateTime.fromISO(`${date}T17:00`, { zone }).toUTC().toISO()!;

    const slots = findAvailableSlots({
      date,
      timezone: zone,
      service,
      barbers: [barber, alternate],
      appointments: [appointment({ id: "a1", customerId: "josh", startAt: requestedStart })],
      requestedBarberId: barber.id,
      includeAlternates: true,
      intervalMinutes: 60,
    });

    expect(slots).toContainEqual(expect.objectContaining({ barberId: alternate.id, startAt: requestedStart }));
    expect(slots).not.toContainEqual(expect.objectContaining({ barberId: barber.id, startAt: requestedStart }));
  });
});

describe("rankRefillCandidates", () => {
  const slotStart = DateTime.fromISO("2026-07-20T17:00", { zone }).toUTC().toISO()!;
  const job: RefillJob = {
    id: "job-1",
    sourceAppointmentId: "josh-appt",
    barberId: barber.id,
    serviceId: service.id,
    slotStartAt: slotStart,
    slotEndAt: DateTime.fromISO(slotStart).plus({ hours: 1 }).toISO()!,
    status: "pending",
    moveDepth: 0,
    attemptedCustomerIds: [],
    timeline: [],
    version: 1,
    createdAt: slotStart,
    updatedAt: slotStart,
  };
  const customers = [
    customer({ id: "sarah", name: "Sarah", earlierMoveConsent: true, contactPreference: "voice" }),
    customer({ id: "alex", name: "Alex" }),
    customer({ id: "pat", name: "Pat", pastCustomerOptIn: true }),
    customer({
      id: "recent",
      name: "Recently contacted",
      pastCustomerOptIn: true,
      lastOutreachAt: DateTime.fromISO(slotStart).minus({ days: 2 }).toISO()!,
    }),
  ];
  const laterAppointment = appointment({
    id: "sarah-appt",
    customerId: "sarah",
    startAt: DateTime.fromISO(slotStart).plus({ hours: 1 }).toISO()!,
  });
  const historicalAppointments = [
    appointment({
      id: "pat-history",
      customerId: "pat",
      startAt: DateTime.fromISO(slotStart).minus({ days: 30 }).toISO()!,
      status: "cancelled",
    }),
    appointment({
      id: "recent-history",
      customerId: "recent",
      startAt: DateTime.fromISO(slotStart).minus({ days: 21 }).toISO()!,
      status: "cancelled",
    }),
  ];
  const waitlist: WaitlistEntry[] = [{
    id: "alex-wait",
    customerId: "alex",
    serviceId: service.id,
    barberId: barber.id,
    date: "2026-07-20",
    earliestStart: "17:00",
    latestStart: "19:00",
    status: "active",
    createdAt: DateTime.fromISO(slotStart).minus({ days: 1 }).toISO()!,
  }];

  it("orders consented later appointments, waitlist matches, then eligible past customers", () => {
    const ranked = rankRefillCandidates({
      job,
      customers,
      appointments: [laterAppointment, ...historicalAppointments],
      waitlist,
      settings,
      now: DateTime.fromISO(slotStart).minus({ hours: 1 }).toISO()!,
    });

    expect(ranked.map((candidate) => [candidate.customerId, candidate.kind])).toEqual([
      ["sarah", "move_earlier"],
      ["alex", "waitlist"],
      ["pat", "past_customer"],
    ]);
  });

  it("stops shifting appointments at the move limit but still ranks waitlist and outreach", () => {
    const ranked = rankRefillCandidates({
      job: { ...job, moveDepth: 3 },
      customers,
      appointments: [laterAppointment, ...historicalAppointments],
      waitlist,
      settings,
      now: DateTime.fromISO(slotStart).minus({ hours: 1 }).toISO()!,
    });

    expect(ranked.map((candidate) => candidate.kind)).toEqual(["waitlist", "past_customer"]);
  });

  it("excludes already-attempted customers", () => {
    const ranked = rankRefillCandidates({
      job: { ...job, attemptedCustomerIds: ["sarah", "alex"] },
      customers,
      appointments: [laterAppointment, ...historicalAppointments],
      waitlist,
      settings,
      now: DateTime.fromISO(slotStart).minus({ hours: 1 }).toISO()!,
    });

    expect(ranked.map((candidate) => candidate.customerId)).toEqual(["pat"]);
  });

  it("excludes a customer from every replacement path when replacement offers are disabled", () => {
    const ranked = rankRefillCandidates({
      job,
      customers: customers.map((candidate) => (
        ["sarah", "alex", "pat"].includes(candidate.id)
          ? { ...candidate, replacementOffersEnabled: false }
          : candidate
      )),
      appointments: [laterAppointment, ...historicalAppointments],
      waitlist,
      settings,
      now: DateTime.fromISO(slotStart).minus({ hours: 1 }).toISO()!,
    });

    expect(ranked).toEqual([]);
  });
});

describe("calculatePastCustomerDiscount", () => {
  it("progresses 5, 10, and 15 percent and respects the configured cap", () => {
    expect(calculatePastCustomerDiscount(0, 15)).toBe(5);
    expect(calculatePastCustomerDiscount(1, 15)).toBe(10);
    expect(calculatePastCustomerDiscount(2, 15)).toBe(15);
    expect(calculatePastCustomerDiscount(8, 12)).toBe(12);
  });
});
