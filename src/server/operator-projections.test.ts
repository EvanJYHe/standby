import { describe, expect, it } from "vitest";

import { InMemoryStore } from "../domain/store.js";
import { recordConversationEvent } from "./conversations.js";
import {
  projectActivity,
  projectConversationDetail,
  projectConversationList,
  projectCustomerDetail,
  projectCustomerList,
  projectWaitlist,
} from "./operator-projections.js";
import { createDemoState } from "./seed.js";

const now = "2026-07-18T16:00:00.000Z";

async function populatedState() {
  const store = new InMemoryStore(createDemoState({
    now,
    timezone: "America/Toronto",
    preservedIdentities: {
      joshTelegramChatId: "1001",
      alexTelegramChatId: "2002",
      sarahPhone: "+14165550101",
    },
  }));
  await recordConversationEvent(store, {
    customerId: "alex",
    channel: "telegram",
    conversationDirection: "outbound",
    providerConversationId: "2002",
    providerEventId: "telegram-1",
    kind: "message",
    direction: "outbound",
    speaker: "agent",
    text: "Alex, a 6 PM appointment opened with Jeremy.",
    deliveryState: "delivered",
    offerId: "offer-alex",
    refillJobId: "job-alex",
    occurredAt: "2026-07-20T16:01:00.000Z",
  });
  await store.transaction((state) => {
    state.refillJobs.push({
      id: "job-alex",
      sourceAppointmentId: "sarah-appt",
      barberId: "jeremy",
      serviceId: "haircut",
      slotStartAt: "2026-07-20T22:00:00.000Z",
      slotEndAt: "2026-07-20T23:00:00.000Z",
      status: "awaiting_offer",
      moveDepth: 1,
      attemptedCustomerIds: ["alex"],
      currentOfferId: "offer-alex",
      timeline: [],
      version: 1,
      createdAt: "2026-07-20T16:01:00.000Z",
      updatedAt: "2026-07-20T16:01:00.000Z",
    });
    state.offers.push({
      id: "offer-alex",
      jobId: "job-alex",
      customerId: "alex",
      candidateKind: "waitlist",
      channel: "telegram",
      status: "delivered",
      proposedStartAt: "2026-07-20T22:00:00.000Z",
      proposedEndAt: "2026-07-20T23:00:00.000Z",
      waitlistEntryId: "alex-waitlist",
      discountPercent: 0,
      expiresAt: "2026-07-20T16:03:00.000Z",
      providerMessageId: "provider-secret-message-id",
      deliveryAttempts: 1,
      createdAt: "2026-07-20T16:01:00.000Z",
      updatedAt: "2026-07-20T16:01:00.000Z",
    });
    state.events.push({
      id: "event-offer",
      type: "offer.delivered",
      aggregateId: "offer-alex",
      occurredAt: "2026-07-20T16:01:00.000Z",
      data: { customerId: "alex", channel: "telegram", raw: "not-for-browser" },
    });
  });
  return store.read();
}

describe("operator projections", () => {
  it("derives the customer booking pool and recurring relationship facts", async () => {
    const state = await populatedState();
    const olivia = state.customers.find((customer) => customer.id === "olivia")!;
    olivia.pastCustomerOptIn = true;
    state.appointments = state.appointments.filter((appointment) => appointment.customerId !== "olivia");
    const historyTemplate = state.appointments.find((appointment) => appointment.id === "demo-zoe-booked-appt")!;
    state.appointments.push(
      {
        ...structuredClone(historyTemplate),
        id: "olivia-visit-one",
        customerId: "olivia",
        startAt: "2026-05-15T18:00:00.000Z",
        endAt: "2026-05-15T19:00:00.000Z",
      },
      {
        ...structuredClone(historyTemplate),
        id: "olivia-visit-two",
        customerId: "olivia",
        startAt: "2026-06-19T18:00:00.000Z",
        endAt: "2026-06-19T19:00:00.000Z",
      },
    );

    const list = projectCustomerList(state);
    const sarah = list.find((customer) => customer.id === "sarah");
    const alex = list.find((customer) => customer.id === "alex");
    const returning = list.find((customer) => customer.id === "olivia");
    const detail = projectCustomerDetail(state, "olivia");

    expect(sarah).toMatchObject({
      bookingState: "booked",
      bookingStateLabel: "Booked",
      nextAppointmentAt: "2026-07-20T18:00:00.000Z",
      nextBarberName: "Jeremy",
      nextServiceName: "Signature haircut",
      outreachEligible: false,
    });
    expect(alex).toMatchObject({
      bookingState: "waitlisted",
      bookingStateLabel: "Waitlisted",
      activeWaitlistCount: 1,
      waitlistRequestSummary: expect.stringContaining("Signature haircut"),
      outreachEligible: false,
    });
    expect(returning).toMatchObject({
      bookingState: "outreach_ready",
      bookingStateLabel: "Ready to contact",
      lastVisitAt: "2026-06-19T18:00:00.000Z",
      visitCount: 2,
      usualServiceName: "Signature haircut",
      usualBarberName: "Maya",
      outreachEligible: true,
      matchReason: expect.stringContaining("2 visits"),
    });
    expect(detail?.relationship).toMatchObject({
      bookingState: "outreach_ready",
      lastVisitAt: "2026-06-19T18:00:00.000Z",
      visitCount: 2,
      usualServiceName: "Signature haircut",
      usualBarberName: "Maya",
      outreachEligible: true,
    });
  });

  it("projects searchable customer summaries and a masked operational detail", async () => {
    const state = await populatedState();
    const list = projectCustomerList(state, "sar");
    const detail = projectCustomerDetail(state, "sarah");

    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "sarah",
        name: "Sarah",
        contactPreference: "voice",
        identitySummary: "Phone linked",
      }),
    ]));
    expect(detail).toMatchObject({
      id: "sarah",
      name: "Sarah",
      identities: { telegram: "Not linked", phone: "••• ••• 0101" },
      preferences: {
        contactPreference: "voice",
        earlierMoveConsent: true,
        flexibleBarberPreference: false,
        pastCustomerOptIn: true,
      },
      appointments: expect.arrayContaining([
        expect.objectContaining({ barberName: "Jeremy", serviceName: "Signature haircut" }),
      ]),
      notes: [expect.objectContaining({ text: expect.stringContaining("phone call") })],
    });
  });

  it("projects conversations, real turns, and compact scheduling context", async () => {
    const state = await populatedState();
    const list = projectConversationList(state);
    const detail = projectConversationDetail(state, list[0]!.id);

    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({
        customerName: "Alex",
        channel: "telegram",
        direction: "outbound",
        preview: "Alex, a 6 PM appointment opened with Jeremy.",
      }),
    ]));
    expect(detail).toMatchObject({
      conversation: expect.objectContaining({ customerName: "Alex" }),
      events: [expect.objectContaining({
        text: "Alex, a 6 PM appointment opened with Jeremy.",
        speaker: "agent",
      })],
      context: {
        customer: expect.objectContaining({ id: "alex", name: "Alex" }),
        appointment: expect.objectContaining({
          barberName: "Jeremy",
          serviceName: "Signature haircut",
          startAt: "2026-07-20T22:00:00.000Z",
        }),
        automation: expect.objectContaining({ state: "Waiting for Alex" }),
      },
    });
  });

  it("projects enriched waitlist and plain-language activity without leaking raw state", async () => {
    const state = await populatedState();
    const waitlist = projectWaitlist(state);
    const activity = projectActivity(state);
    const serialized = JSON.stringify({
      customers: projectCustomerList(state),
      customer: projectCustomerDetail(state, "sarah"),
      conversations: projectConversationList(state),
      conversation: projectConversationDetail(state, state.conversations[0]!.id),
      waitlist,
      activity,
    });

    expect(waitlist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "alex-waitlist",
        customerName: "Alex",
        serviceName: "Signature haircut",
        barberName: "Jeremy",
        channel: "telegram",
      }),
    ]));
    expect(activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "Standby delivered an appointment offer to Alex via Telegram." }),
    ]));
    expect(serialized).not.toContain("+14165550101");
    expect(serialized).not.toContain('"telegramChatId"');
    expect(serialized).not.toContain('"providerConversationId"');
    expect(serialized).not.toContain("provider-secret-message-id");
    expect(serialized).not.toContain("not-for-browser");
  });
});
