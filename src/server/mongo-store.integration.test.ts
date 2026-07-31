import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StandbyState } from "../domain/store.js";
import type { Appointment, SchedulingSettings } from "../domain/types.js";
import { MongoStandbyStore } from "./mongo-store.js";

const settings: SchedulingSettings = {
  timezone: "America/Toronto",
  refillEnabled: true,
  moveEarlierEnabled: true,
  moveLimit: 3,
  allowAlternateBarbers: true,
  waitlistEnabled: true,
  pastCustomerOutreachEnabled: true,
  maxDiscountPercent: 15,
  offerExpirySeconds: 120,
};

function initialState(): StandbyState {
  return {
    customers: [{
      id: "alex",
      name: "Alex",
      telegramChatId: "2002",
      phone: "+14165550101",
      contactPreference: "telegram",
      earlierMoveConsent: false,
      flexibleBarberPreference: false,
      pastCustomerOptIn: false,
    }],
    barbers: [{
      id: "jeremy",
      name: "Jeremy",
      serviceIds: ["haircut"],
      weeklyHours: { 1: [{ start: "09:00", end: "20:00" }] },
    }],
    services: [{ id: "haircut", name: "Signature haircut", durationMinutes: 60, priceCents: 4500 }],
    appointments: [],
    waitlist: [],
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

function appointment(id: string): Appointment {
  return {
    id,
    customerId: "alex",
    barberId: "jeremy",
    serviceId: "haircut",
    startAt: "2026-07-20T21:00:00.000Z",
    endAt: "2026-07-20T22:00:00.000Z",
    status: "confirmed",
    discountPercent: 0,
    version: 1,
    history: [],
  };
}

describe("MongoStandbyStore", () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let store: MongoStandbyStore;
  const databaseName = "standby_integration";

  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    client = new MongoClient(replicaSet.getUri());
    await client.connect();
    store = new MongoStandbyStore(client, databaseName);
    await store.initialize(initialState());
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await replicaSet?.stop();
  });

  it("creates the scheduling, identity, offer, and idempotency indexes", async () => {
    const database = client.db(databaseName);
    const appointmentIndexes = await database.collection("appointments").indexes();
    const customerIndexes = await database.collection("customers").indexes();
    const offerIndexes = await database.collection("outreach_offers").indexes();
    const eventIndexes = await database.collection("processed_provider_events").indexes();
    const conversationIndexes = await database.collection("conversations").indexes();
    const conversationEventIndexes = await database.collection("conversation_events").indexes();

    expect(appointmentIndexes.map((index) => index.name)).toContain("one_confirmed_barber_start");
    expect(customerIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "unique_telegram_chat",
      "unique_normalized_phone",
    ]));
    expect(offerIndexes.map((index) => index.name)).toContain("one_pending_offer_per_job");
    expect(eventIndexes.map((index) => index.name)).toContain("provider_event_idempotency");
    expect(conversationIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "provider_conversation_identity",
      "customer_conversations",
    ]));
    expect(conversationEventIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "conversation_event_identity",
      "conversation_event_timeline",
    ]));
  });

  it("serves isolated reads from the initialized snapshot", async () => {
    const readState = vi.spyOn(
      store as unknown as { readState(): Promise<StandbyState> },
      "readState",
    );

    try {
      const first = await store.read();
      first.customers[0]!.name = "Changed outside the store";
      const second = await store.read();

      expect(second.customers[0]!.name).toBe("Alex");
      expect(readState).not.toHaveBeenCalled();
    } finally {
      readState.mockRestore();
    }
  });

  it("persists state changes inside a Mongo transaction", async () => {
    await store.transaction((state) => {
      state.appointments.push(appointment("first"));
      state.events.push({
        id: "event-1",
        type: "appointment.booked",
        aggregateId: "first",
        occurredAt: "2026-07-20T15:00:00.000Z",
      });
    });

    const snapshot = await store.read();
    expect(snapshot.appointments).toContainEqual(expect.objectContaining({ id: "first" }));
    expect(snapshot.events).toContainEqual(expect.objectContaining({ id: "event-1" }));
  });

  it("observes changes committed by another server instance", async () => {
    const observer = new MongoStandbyStore(client, databaseName, 0);
    await observer.initialize(initialState());

    await store.transaction((state) => {
      state.events.push({
        id: "event-from-another-instance",
        type: "appointment.updated",
        aggregateId: "first",
        occurredAt: "2026-07-20T15:10:00.000Z",
      });
    });

    expect((await observer.read()).events).toContainEqual(
      expect.objectContaining({ id: "event-from-another-instance" }),
    );
  });

  it("round-trips normalized conversations and customer notes", async () => {
    await store.transaction((state) => {
      state.conversations.push({
        id: "conversation-1",
        customerId: "alex",
        channel: "telegram",
        direction: "inbound",
        providerConversationId: "chat-2002",
        state: "active",
        preview: "Hello",
        createdAt: "2026-07-20T15:00:00.000Z",
        updatedAt: "2026-07-20T15:00:00.000Z",
      });
      state.conversationEvents.push({
        id: "conversation-event-1",
        conversationId: "conversation-1",
        kind: "message",
        direction: "inbound",
        speaker: "customer",
        text: "Hello",
        providerEventId: "update-1",
        occurredAt: "2026-07-20T15:00:00.000Z",
      });
      state.customerNotes.push({
        id: "note-1",
        customerId: "alex",
        text: "Prefers the chair near the window.",
        author: "operator",
        createdAt: "2026-07-20T15:00:00.000Z",
      });
    });

    const snapshot = await store.read();
    expect(snapshot.conversations).toContainEqual(expect.objectContaining({ id: "conversation-1" }));
    expect(snapshot.conversationEvents).toContainEqual(expect.objectContaining({ id: "conversation-event-1" }));
    expect(snapshot.customerNotes).toContainEqual(expect.objectContaining({ id: "note-1" }));
  });

  it("notifies live subscribers after void state transactions", async () => {
    await store.replace(initialState());
    let observedEventId: string | undefined;
    const unsubscribe = store.subscribe((state) => {
      observedEventId = state.events.at(-1)?.id;
    });

    await store.transaction((state) => {
      state.events.push({
        id: "event-for-sse",
        type: "appointment.updated",
        aggregateId: "first",
        occurredAt: "2026-07-20T15:00:00.000Z",
      });
    });
    unsubscribe();

    expect(observedEventId).toBe("event-for-sse");
  });

  it("allows only one concurrent transaction to claim a confirmed barber/start slot", async () => {
    await store.replace(initialState());

    const outcomes = await Promise.allSettled([
      store.transaction((state) => state.appointments.push(appointment("contender-a"))),
      store.transaction((state) => state.appointments.push(appointment("contender-b"))),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await store.read()).appointments).toHaveLength(1);
  });
});
