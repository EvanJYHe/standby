import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StandbyEngine } from "../domain/engine.js";
import { InMemoryStore } from "../domain/store.js";
import type { ActorContext } from "../domain/types.js";
import { buildServer } from "./app.js";
import type { AppConfig } from "./config.js";
import { recordConversationEvent } from "./conversations.js";
import { createDemoState, getDemoDate } from "./seed.js";

const now = "2026-07-18T16:00:00.000Z";
const config: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  publicBaseUrl: "http://localhost:3000",
  timezone: "America/Toronto",
  demoMode: true,
  voiceActorSecret: "test-voice-actor-secret-with-enough-length",
  dataStore: "memory",
  mongoUri: undefined,
  mongoDatabase: "standby_test",
  telegramBotToken: undefined,
  telegramWebhookSecret: undefined,
  telegramLocalPolling: false,
  telegramApiIp: undefined,
  backboardApiKey: undefined,
  backboardAssistantId: undefined,
  backboardApiIp: undefined,
  elevenLabsApiKey: undefined,
  elevenLabsAgentId: undefined,
  elevenLabsPhoneNumberId: undefined,
  elevenLabsWebhookSecret: undefined,
  sarahPhone: "+14165550101",
};

describe("Standby Fastify API", () => {
  let store: InMemoryStore;
  let engine: StandbyEngine;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    store = new InMemoryStore(createDemoState({
      now,
      timezone: config.timezone,
      preservedIdentities: {
        joshTelegramChatId: "1001",
        alexTelegramChatId: "2002",
        sarahPhone: config.sarahPhone!,
      },
    }));
    engine = new StandbyEngine(store);
    app = await buildServer({ config, store, engine, clock: () => now });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns health and explicit provider readiness without exposing secrets", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "standby",
      providers: {
        mongodb: "memory",
        telegram: "unconfigured",
        backboard: "unconfigured",
        elevenlabs: "unconfigured",
      },
    });
    expect(response.body).not.toContain("test-voice-actor-secret");
  });

  it("opens local operator routes without a bearer session", async () => {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/customers" }),
      app.inject({ method: "GET", url: "/api/v1/conversations" }),
      app.inject({ method: "GET", url: "/api/v1/waitlist" }),
      app.inject({ method: "GET", url: "/api/v1/activity" }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect((await app.inject({
      method: "POST",
      url: "/api/v1/admin/session",
      payload: { pin: "4242" },
    })).statusCode).toBe(404);
  });

  it("reports ElevenLabs ready only when the outbound destination is configured", async () => {
    const voiceConfig: AppConfig = {
      ...config,
      elevenLabsApiKey: "elevenlabs-key",
      elevenLabsAgentId: "agent-1",
      elevenLabsPhoneNumberId: "phone-1",
      elevenLabsWebhookSecret: "voice-webhook-secret-that-is-long-enough",
      sarahPhone: undefined,
    };
    const healthFor = async (candidateConfig: AppConfig) => {
      const candidateStore = new InMemoryStore(createDemoState({
        now,
        timezone: candidateConfig.timezone,
      }));
      const candidateApp = await buildServer({
        config: candidateConfig,
        store: candidateStore,
        engine: new StandbyEngine(candidateStore),
        clock: () => now,
      });
      try {
        return (await candidateApp.inject({ method: "GET", url: "/health" })).json();
      } finally {
        await candidateApp.close();
      }
    };

    await expect(healthFor(voiceConfig)).resolves.toMatchObject({
      providers: { elevenlabs: "unconfigured" },
    });
    await expect(healthFor({ ...voiceConfig, sarahPhone: "+14165550101" })).resolves.toMatchObject({
      providers: { elevenlabs: "configured" },
    });
  });

  it("returns an authoritative enriched calendar with active refill state", async () => {
    const actor: ActorContext = { provider: "telegram", customerId: "josh" };
    await engine.cancel({ actor, appointmentId: "josh-appt", now });
    const date = getDemoDate(now, config.timezone);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/calendar?date=${date}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date,
      timezone: config.timezone,
      appointments: expect.arrayContaining([
        expect.objectContaining({ customerName: "Josh", status: "cancelled" }),
        expect.objectContaining({ customerName: "Sarah", status: "confirmed" }),
      ]),
      activeRefills: [expect.objectContaining({
        customerState: "Finding a replacement…",
        status: "pending",
      })],
    });
  });

  it("validates and persists settings patches", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: { moveLimit: 2, maxDiscountPercent: 10, allowAlternateBarbers: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      moveLimit: 2,
      maxDiscountPercent: 10,
      allowAlternateBarbers: false,
    });
    expect((await store.read()).settings.moveLimit).toBe(2);

    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: { moveLimit: 9 },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("returns the plain-language timeline for a refill job", async () => {
    await engine.cancel({
      actor: { provider: "telegram", customerId: "josh" },
      appointmentId: "josh-appt",
      now,
    });
    const jobId = (await store.read()).refillJobs.find(
      (candidate) => candidate.sourceAppointmentId === "josh-appt",
    )!.id;
    await store.transaction((state) => {
      const job = state.refillJobs.find((candidate) => candidate.id === jobId)!;
      job.status = "awaiting_offer";
      job.currentOfferId = "safe-offer";
      state.offers.push({
        id: "safe-offer",
        jobId,
        customerId: "sarah",
        candidateKind: "move_earlier",
        channel: "voice",
        status: "delivered",
        proposedStartAt: job.slotStartAt,
        proposedEndAt: job.slotEndAt,
        originalAppointmentId: "sarah-appt",
        originalStartAt: "2026-07-20T22:00:00.000Z",
        discountPercent: 0,
        expiresAt: "2026-07-20T16:02:00.000Z",
        providerMessageId: "private-provider-message-id",
        deliveryAttempts: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/refill-jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: jobId,
      barberName: "Jeremy",
      serviceName: "Signature haircut",
      timeline: [expect.objectContaining({ message: expect.stringContaining("cancelled") })],
    });
    expect(response.body).not.toContain("private-provider-message-id");
  });

  it("lets an operator close an active Open Chair and invalidates its offer", async () => {
    await engine.cancel({
      actor: { provider: "telegram", customerId: "josh" },
      appointmentId: "josh-appt",
      now,
    });
    const job = (await store.read()).refillJobs[0]!;
    await store.transaction((state) => {
      const current = state.refillJobs.find((candidate) => candidate.id === job.id)!;
      current.status = "awaiting_offer";
      current.currentOfferId = "offer-to-cancel";
      state.offers.push({
        id: "offer-to-cancel",
        jobId: current.id,
        customerId: "sarah",
        candidateKind: "past_customer",
        channel: "voice",
        status: "delivered",
        proposedStartAt: current.slotStartAt,
        proposedEndAt: current.slotEndAt,
        discountPercent: 0,
        expiresAt: "2026-07-20T16:15:00.000Z",
        deliveryAttempts: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/refill-jobs/${job.id}/cancel`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: job.id, status: "cancelled" });
    const snapshot = await store.read();
    expect(snapshot.refillJobs.find((candidate) => candidate.id === job.id)).toMatchObject({
      status: "cancelled",
      timeline: expect.arrayContaining([expect.objectContaining({ type: "opening_cancelled" })]),
    });
    expect(snapshot.offers.find((offer) => offer.id === "offer-to-cancel")?.status).toBe("expired");
  });

  it("resets the local demo and preserves provider-linked identities", async () => {
    await store.transaction((state) => {
      state.customers.find((customer) => customer.id === "josh")!.telegramChatId = "updated-josh";
      state.customers.find((customer) => customer.id === "alex")!.telegramChatId = "updated-alex";
      state.customers.find((customer) => customer.id === "sarah")!.phone = "+14165550999";
    });
    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/demo/reset",
    });

    expect(reset.statusCode).toBe(200);
    const snapshot = await store.read();
    expect(snapshot.customers.find((customer) => customer.id === "josh")?.telegramChatId).toBe("updated-josh");
    expect(snapshot.customers.find((customer) => customer.id === "alex")?.telegramChatId).toBe("updated-alex");
    expect(snapshot.customers.find((customer) => customer.id === "sarah")?.phone).toBe("+14165550999");
  });

  it("emits an SSE-compatible authoritative refresh event", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/events?once=true" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: connected");
    expect(response.body).toContain("data:");
  });

  it("returns inclusive calendar ranges and rejects ranges longer than 42 days", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?start=2026-07-20&end=2026-07-24",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date: "2026-07-20",
      range: { start: "2026-07-20", end: "2026-07-24" },
      appointments: expect.arrayContaining([
        expect.objectContaining({ id: "josh-appt" }),
        expect.objectContaining({ id: "fri-nadia" }),
      ]),
    });

    const tooLong = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?start=2026-07-01&end=2026-08-20",
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it("returns safe customer, waitlist, conversation, and activity models", async () => {
    await recordConversationEvent(store, {
      customerId: "alex",
      channel: "telegram",
      conversationDirection: "inbound",
      providerConversationId: "2002",
      providerEventId: "update-44",
      kind: "message",
      direction: "inbound",
      speaker: "customer",
      text: "Is six still open?",
      occurredAt: now,
    });

    const customers = await app.inject({ method: "GET", url: "/api/v1/customers?q=alex" });
    const detail = await app.inject({ method: "GET", url: "/api/v1/customers/alex" });
    const waitlist = await app.inject({ method: "GET", url: "/api/v1/waitlist" });
    const conversations = await app.inject({ method: "GET", url: "/api/v1/conversations" });
    const conversationId = conversations.json<Array<{ id: string }>>()[0]!.id;
    const conversation = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}`,
    });
    const activity = await app.inject({ method: "GET", url: "/api/v1/activity" });

    for (const response of [customers, detail, waitlist, conversations, conversation, activity]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("+14165550101");
      expect(response.body).not.toContain("telegramChatId");
      expect(response.body).not.toContain("providerConversationId");
    }
    expect(customers.json()).toEqual([expect.objectContaining({ name: "Alex" })]);
    expect(conversation.json()).toMatchObject({
      events: [expect.objectContaining({ text: "Is six still open?" })],
    });
  });

  it("uses live availability and the deterministic engine for operator appointment mutations", async () => {
    const availability = await app.inject({
      method: "GET",
      url: "/api/v1/availability?date=2026-07-20&serviceId=haircut&barberId=jeremy",
    });
    expect(availability.statusCode).toBe(200);
    expect(availability.json()).toMatchObject({
      date: "2026-07-20",
      slots: expect.arrayContaining([
        expect.objectContaining({ barberId: "jeremy", startAt: "2026-07-20T13:00:00.000Z" }),
      ]),
    });

    const booking = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: {
        customerId: "alex",
        barberId: "jeremy",
        serviceId: "haircut",
        startAt: "2026-07-20T13:00:00.000Z",
      },
    });
    expect(booking.statusCode).toBe(200);
    const appointmentId = booking.json<{ appointmentId: string }>().appointmentId;
    const collision = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: {
        customerId: "nadia",
        barberId: "jeremy",
        serviceId: "haircut",
        startAt: "2026-07-20T13:00:00.000Z",
      },
    });
    expect(collision.statusCode).toBe(409);

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/appointments/${appointmentId}`,
      payload: { barberId: "jeremy", startAt: "2026-07-21T13:00:00.000Z" },
    });
    expect(moved.statusCode).toBe(200);
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await store.read()).appointments.find((item) => item.id === appointmentId)).toMatchObject({
      startAt: "2026-07-21T13:00:00.000Z",
      status: "cancelled",
    });
  });

  it("reports closure and rejects weekend or after-hours bookings", async () => {
    const calendar = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?date=2026-07-20",
    });
    expect(calendar.json()).toMatchObject({ businessHours: { start: "09:00", end: "17:00" } });

    const weekendAvailability = await app.inject({
      method: "GET",
      url: "/api/v1/availability?date=2026-07-25&serviceId=haircut&barberId=jeremy",
    });
    expect(weekendAvailability.json()).toMatchObject({
      closed: true,
      slots: [],
      message: "We're closed at that time. We're open Monday through Friday from 9:00 AM to 5:00 PM.",
    });

    for (const startAt of ["2026-07-25T17:00:00.000Z", "2026-07-20T21:00:00.000Z"]) {
      const booking = await app.inject({
        method: "POST",
        url: "/api/v1/appointments",
        payload: {
          customerId: "alex",
          barberId: "jeremy",
          serviceId: "haircut",
          startAt,
        },
      });
      expect(booking.statusCode).toBe(400);
      expect(booking.json()).toMatchObject({
        type: "error",
        code: "INVALID_REQUEST",
        message: "We're closed at that time. We're open Monday through Friday from 9:00 AM to 5:00 PM.",
      });
    }
  });

  it("removes a customer from an active replacement offer when outreach is disabled", async () => {
    await engine.cancel({
      actor: { provider: "telegram", customerId: "josh" },
      appointmentId: "josh-appt",
      now,
    });
    const job = (await store.read()).refillJobs.find(
      (candidate) => candidate.sourceAppointmentId === "josh-appt",
    )!;
    await store.transaction((state) => {
      const current = state.refillJobs.find((candidate) => candidate.id === job.id)!;
      current.status = "awaiting_offer";
      current.currentOfferId = "active-sarah-offer";
      state.offers.push({
        id: "active-sarah-offer",
        jobId: current.id,
        customerId: "sarah",
        candidateKind: "past_customer",
        channel: "voice",
        status: "delivered",
        proposedStartAt: current.slotStartAt,
        proposedEndAt: current.slotEndAt,
        discountPercent: 0,
        expiresAt: "2026-07-20T16:15:00.000Z",
        deliveryAttempts: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/customers/sarah",
      payload: { replacementOffersEnabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      preferences: { replacementOffersEnabled: false },
    });
    const snapshot = await store.read();
    expect(snapshot.offers.find((offer) => offer.id === "active-sarah-offer")?.status).toBe("declined");
    expect(snapshot.refillJobs.find((candidate) => candidate.id === job.id)).toMatchObject({
      status: "pending",
    });
    expect(snapshot.refillJobs.find((candidate) => candidate.id === job.id)?.currentOfferId).toBeUndefined();
  });

  it("updates customer preferences, notes, and waitlist state with SSE-visible events", async () => {
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/v1/customers/sarah",
      payload: { flexibleBarberPreference: true, earlierMoveConsent: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      preferences: { flexibleBarberPreference: true, earlierMoveConsent: false },
    });
    const note = await app.inject({
      method: "POST",
      url: "/api/v1/customers/sarah/notes",
      payload: { text: "  Please confirm major changes by phone.  " },
    });
    expect(note.statusCode).toBe(200);
    expect(note.json()).toMatchObject({ text: "Please confirm major changes by phone." });
    const waitlist = await app.inject({
      method: "PATCH",
      url: "/api/v1/waitlist/nadia-waitlist",
      payload: { status: "paused", operatorNote: "Hold until tomorrow." },
    });
    expect(waitlist.statusCode).toBe(200);
    expect(waitlist.json()).toMatchObject({ status: "paused", operatorNote: "Hold until tomorrow." });

    const events = (await store.read()).events.map((event) => event.type);
    expect(events).toEqual(expect.arrayContaining([
      "customer.updated",
      "customer.note_added",
      "waitlist.updated",
    ]));
  });
});
