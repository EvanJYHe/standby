import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { rankRefillCandidates } from "../domain/scheduling.js";
import { projectCustomerList } from "./operator-projections.js";
import { createDemoState, getDemoDate } from "./seed.js";

describe("demo seed", () => {
  it("uses the next operational weekday for a weekend reset", () => {
    expect(getDemoDate("2026-07-18T12:00:00.000-04:00", "America/Toronto")).toBe("2026-07-20");
  });

  it("creates the Josh, Sarah, and Alex golden path within weekday shop hours", () => {
    const state = createDemoState({
      now: "2026-07-18T16:00:00.000Z",
      timezone: "America/Toronto",
    });
    const demoDate = "2026-07-20";
    const at = (hour: number) => DateTime.fromISO(`${demoDate}T${hour}:00`, {
      zone: "America/Toronto",
    }).toUTC().toISO();

    expect(state.appointments).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerId: "josh", barberId: "jeremy", startAt: at(13) }),
      expect.objectContaining({ customerId: "sarah", barberId: "jeremy", startAt: at(14) }),
    ]));
    expect(state.appointments).not.toContainEqual(
      expect.objectContaining({ barberId: "jeremy", startAt: at(17), status: "confirmed" }),
    );
    expect(state.waitlist).toContainEqual(expect.objectContaining({
      customerId: "alex",
      barberId: "jeremy",
      earliestStart: "14:00",
      latestStart: "16:00",
      status: "active",
    }));
    expect(state.customers.find((customer) => customer.id === "sarah")).toMatchObject({
      contactPreference: "voice",
      earlierMoveConsent: true,
    });
  });

  it("preserves linked Telegram IDs and Sarah's configured phone across reset", () => {
    const state = createDemoState({
      now: "2026-07-18T16:00:00.000Z",
      timezone: "America/Toronto",
      preservedIdentities: {
        joshTelegramChatId: "1001",
        alexTelegramChatId: "2002",
        sarahPhone: "+14165550101",
      },
    });

    expect(state.customers.find((customer) => customer.id === "josh")?.telegramChatId).toBe("1001");
    expect(state.customers.find((customer) => customer.id === "alex")?.telegramChatId).toBe("2002");
    expect(state.customers.find((customer) => customer.id === "sarah")?.phone).toBe("+14165550101");
  });

  it("seeds a larger recurring-customer pool than the currently booked population", () => {
    const state = createDemoState({
      now: "2026-07-18T16:00:00.000Z",
      timezone: "America/Toronto",
    });
    const summaries = projectCustomerList(state);
    const booked = summaries.filter((customer) => customer.bookingState === "booked");
    const waitlisted = summaries.filter((customer) => customer.bookingState === "waitlisted");
    const outreachReady = summaries.filter((customer) => customer.bookingState === "outreach_ready");
    const notEligible = summaries.filter((customer) => customer.bookingState === "not_eligible");
    const recurring = summaries.filter((customer) => customer.visitCount >= 3);
    const demoWeekEnd = DateTime.fromISO("2026-07-20", { zone: state.settings.timezone }).plus({ days: 5 });
    const demoWeekMinutes = state.appointments
      .filter((appointment) => {
        const start = DateTime.fromISO(appointment.startAt).setZone(state.settings.timezone);
        return appointment.status === "confirmed"
          && start >= DateTime.fromISO("2026-07-20", { zone: state.settings.timezone })
          && start < demoWeekEnd;
      })
      .reduce((minutes, appointment) => (
        minutes + DateTime.fromISO(appointment.endAt).diff(DateTime.fromISO(appointment.startAt), "minutes").minutes
      ), 0);
    const capacityMinutes = 3 * 5 * 10 * 60;

    expect(state.customers.length).toBeGreaterThan(booked.length);
    expect(state.customers.length).toBeGreaterThanOrEqual(50);
    expect(waitlisted.length).toBeGreaterThanOrEqual(3);
    expect(outreachReady.length).toBeGreaterThanOrEqual(8);
    expect(notEligible.length).toBeGreaterThanOrEqual(3);
    expect(recurring.length).toBeGreaterThanOrEqual(20);
    expect(demoWeekMinutes / capacityMinutes).toBeGreaterThanOrEqual(0.70);
    expect(demoWeekMinutes / capacityMinutes).toBeLessThanOrEqual(0.80);
  });

  it("creates a realistic collision-free operational week without fake provider activity", () => {
    const state = createDemoState({
      now: "2026-07-18T16:00:00.000Z",
      timezone: "America/Toronto",
    });
    const confirmed = state.appointments.filter((appointment) => appointment.status === "confirmed");
    const uniqueSlots = new Set(confirmed.map((appointment) => `${appointment.barberId}:${appointment.startAt}`));

    expect(confirmed.length).toBeGreaterThanOrEqual(20);
    expect(uniqueSlots.size).toBe(confirmed.length);
    for (const barber of state.barbers) {
      const workingDates = new Set(confirmed
        .filter((appointment) => appointment.barberId === barber.id)
        .map((appointment) => DateTime.fromISO(appointment.startAt)
          .setZone(state.settings.timezone)
          .toISODate()));
      expect(workingDates.size).toBeGreaterThanOrEqual(3);
    }
    expect(state.conversations).toEqual([]);
    expect(state.conversationEvents).toEqual([]);
    expect(state.customerNotes).toHaveLength(2);
  });

  it("keeps Alex first for Sarah's successor opening", () => {
    const state = createDemoState({
      now: "2026-07-18T16:00:00.000Z",
      timezone: "America/Toronto",
    });
    const sarah = state.appointments.find((appointment) => appointment.id === "sarah-appt")!;
    const originalStartAt = sarah.startAt;
    const originalEndAt = sarah.endAt;
    sarah.startAt = DateTime.fromISO(sarah.startAt).minus({ hours: 1 }).toUTC().toISO()!;
    sarah.endAt = DateTime.fromISO(sarah.endAt).minus({ hours: 1 }).toUTC().toISO()!;

    const ranked = rankRefillCandidates({
      job: {
        id: "successor-job",
        sourceAppointmentId: "sarah-appt",
        barberId: "jeremy",
        serviceId: "haircut",
        slotStartAt: originalStartAt,
        slotEndAt: originalEndAt,
        status: "pending",
        moveDepth: 1,
        attemptedCustomerIds: [],
        timeline: [],
        version: 1,
        createdAt: "2026-07-20T16:01:00.000Z",
        updatedAt: "2026-07-20T16:01:00.000Z",
      },
      customers: state.customers,
      appointments: state.appointments,
      waitlist: state.waitlist,
      settings: state.settings,
      now: "2026-07-20T16:01:00.000Z",
    });

    expect(ranked[0]).toMatchObject({ customerId: "alex", kind: "waitlist" });
    expect(state.waitlist.filter((entry) => entry.date === "2026-07-20")).toHaveLength(1);
  });
});
