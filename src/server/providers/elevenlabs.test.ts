import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { StandbyEngine } from "../../domain/engine.js";
import { InMemoryStore } from "../../domain/store.js";
import { createDemoState } from "../seed.js";
import { SchedulingToolbox } from "./scheduling-tools.js";
import {
  ElevenLabsOutboundClient,
  ElevenLabsWebhookService,
} from "./elevenlabs.js";
import { createVoiceActorToken, verifyVoiceActorToken } from "./voice-session.js";

const now = "2026-07-18T16:00:00.000Z";
const timezone = "America/Toronto";
const secret = "voice-webhook-secret-that-is-long-enough";
const actorTokenSecret = "voice-actor-secret-that-is-at-least-32-characters";

function signedWebhook(
  body: string,
  webhookSecret: string,
  timestampSeconds = Math.floor(Date.parse(now) / 1000),
): string {
  const timestamp = timestampSeconds.toString();
  const digest = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v0=${digest}`;
}

describe("voice actor tokens", () => {
  it("binds a customer and optional offer to a signed short-lived token", () => {
    const token = createVoiceActorToken({
      customerId: "sarah",
      callId: "call-1",
      offerId: "offer-sarah",
      expiresAt: "2026-07-18T18:00:00.000Z",
    }, secret);

    expect(verifyVoiceActorToken(token, secret, now)).toMatchObject({
      customerId: "sarah",
      callId: "call-1",
      offerId: "offer-sarah",
    });
    expect(() => verifyVoiceActorToken(`${token}tampered`, secret, now)).toThrow("Invalid voice actor token");
  });
});

describe("ElevenLabsWebhookService", () => {
  it("authenticates an unlinked caller for read-only tools but blocks customer mutations", async () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const engine = new StandbyEngine(store);
    const service = new ElevenLabsWebhookService({
      store,
      toolbox: new SchedulingToolbox(store, engine, () => now),
      agentId: "agent-1",
      webhookSecret: secret,
      actorTokenSecret,
      clock: () => now,
    });

    const context = await service.inboundContext({
      caller_id: "+1 (416) 555-0199",
      called_number: "+14165550000",
      agent_id: "agent-1",
      call_sid: "guest-call",
    });
    const authorization = `Bearer ${context.dynamic_variables.secret__actor_token}`;
    expect(() => verifyVoiceActorToken(
      context.dynamic_variables.secret__actor_token,
      secret,
      now,
    )).toThrow("Invalid voice actor token");
    expect(verifyVoiceActorToken(
      context.dynamic_variables.secret__actor_token,
      actorTokenSecret,
      now,
    )).toMatchObject({ callId: "guest-call" });

    await expect(service.executeTool("get_shop_info", { topic: "hours" }, authorization))
      .resolves.toMatchObject({ name: "Standby", hours: expect.any(String) });
    await expect(service.executeTool("get_my_appointments", {}, authorization))
      .resolves.toMatchObject({ type: "error", code: "UNLINKED_ACTOR" });
  });

  it("maps inbound caller context and authenticates tools from the signed header, not model arguments", async () => {
    const store = new InMemoryStore(createDemoState({
      now,
      timezone,
      contactOverrides: { sarah: { phone: "+14165550101" } },
    }));
    const engine = new StandbyEngine(store);
    const toolbox = new SchedulingToolbox(store, engine, () => now);
    const service = new ElevenLabsWebhookService({
      store,
      toolbox,
      agentId: "agent-1",
      webhookSecret: secret,
      actorTokenSecret,
      clock: () => now,
    });

    const context = await service.inboundContext({
      caller_id: "+1 (416) 555-0101",
      called_number: "+14165550000",
      agent_id: "agent-1",
      call_sid: "call-1",
    });
    expect(context).toMatchObject({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        customer_id: "sarah",
        customer_name: "Sarah",
        timezone,
        secret__actor_token: expect.any(String),
        offer_id: "",
        offer_message: "I can help you find and book an appointment. What day and time are you available?",
        barber_name: "",
        service_name: "",
        old_time: "",
        proposed_time: "",
        discount_percent: 0,
        appointment_summary: expect.stringContaining("Signature haircut with Jeremy"),
      },
    });
    const token = context.dynamic_variables.secret__actor_token;
    const result = await service.executeTool(
      "cancel_appointment",
      { appointment_id: "josh-appt", customer_id: "josh" },
      `Bearer ${token}`,
    );
    expect(result).toMatchObject({ type: "error" });
    expect((await store.read()).appointments.find((appointment) => appointment.id === "josh-appt")?.status)
      .toBe("confirmed");

    await expect(service.executeTool("get_my_appointments", {}, token))
      .resolves.toMatchObject({
        appointments: expect.arrayContaining([expect.objectContaining({ id: "sarah-appt" })]),
      });
  });

  it("verifies HMAC post-call failures, deduplicates them, and releases failed outreach", async () => {
    const initial = createDemoState({
      now,
      timezone,
      contactOverrides: { sarah: { phone: "+14165550101" } },
    });
    initial.refillJobs.push({
      id: "job-1",
      sourceAppointmentId: "josh-appt",
      barberId: "jeremy",
      serviceId: "haircut",
      slotStartAt: "2026-07-20T21:00:00.000Z",
      slotEndAt: "2026-07-20T22:00:00.000Z",
      status: "awaiting_offer",
      moveDepth: 0,
      attemptedCustomerIds: ["sarah"],
      currentOfferId: "offer-sarah",
      timeline: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    initial.offers.push({
      id: "offer-sarah",
      jobId: "job-1",
      customerId: "sarah",
      candidateKind: "move_earlier",
      channel: "voice",
      status: "delivered",
      proposedStartAt: "2026-07-20T21:00:00.000Z",
      proposedEndAt: "2026-07-20T22:00:00.000Z",
      originalAppointmentId: "sarah-appt",
      originalStartAt: "2026-07-20T22:00:00.000Z",
      discountPercent: 0,
      expiresAt: "2026-07-20T16:05:00.000Z",
      providerMessageId: "conversation-1",
      deliveryAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    const store = new InMemoryStore(initial);
    const engine = new StandbyEngine(store);
    const service = new ElevenLabsWebhookService({
      store,
      toolbox: new SchedulingToolbox(store, engine, () => now),
      agentId: "agent-1",
      webhookSecret: secret,
      actorTokenSecret,
      clock: () => now,
    });
    const event = JSON.stringify({
      type: "call_initiation_failure",
      event_timestamp: 1_752_000_000,
      data: {
        agent_id: "agent-1",
        conversation_id: "conversation-1",
        failure_reason: "no-answer",
        metadata: { type: "twilio", body: { CallStatus: "no-answer" } },
      },
    });
    const signature = signedWebhook(event, secret);

    const first = await service.handlePostCall(event, signature);
    const duplicate = await service.handlePostCall(event, signature);

    expect(first).toEqual({ status: "processed" });
    expect(duplicate).toEqual({ status: "duplicate" });
    const snapshot = await store.read();
    expect(snapshot.offers.find((offer) => offer.id === "offer-sarah")?.status).toBe("delivery_failed");
    expect(snapshot.refillJobs.find((job) => job.id === "job-1"))
      .toMatchObject({ status: "pending", retryAt: now });
    expect(snapshot.refillJobs.find((job) => job.id === "job-1")?.currentOfferId).toBeUndefined();
    expect(snapshot.conversations).toContainEqual(expect.objectContaining({
      customerId: "sarah",
      channel: "voice",
      providerConversationId: "elevenlabs:conversation-1",
      state: "failed",
    }));
    expect(snapshot.conversationEvents).toContainEqual(expect.objectContaining({
      kind: "error",
      speaker: "system",
      text: "Outbound call failed: no answer.",
      deliveryState: "failed",
      offerId: "offer-sarah",
    }));
    expect(JSON.stringify(snapshot.conversationEvents)).not.toContain("CallStatus");
    await expect(service.handlePostCall(event, "t=bad,v0=bad")).rejects.toThrow("Invalid ElevenLabs signature");
    await expect(service.handlePostCall(
      event,
      signedWebhook(event, secret, Math.floor(Date.parse(now) / 1000) + 60 * 60),
    )).rejects.toThrow("Invalid ElevenLabs signature");
  });

  it("persists documented transcript turns without audio or raw webhook metadata", async () => {
    const store = new InMemoryStore(createDemoState({
      now,
      timezone,
      contactOverrides: { sarah: { phone: "+14165550101" } },
    }));
    const engine = new StandbyEngine(store);
    const service = new ElevenLabsWebhookService({
      store,
      toolbox: new SchedulingToolbox(store, engine, () => now),
      agentId: "agent-1",
      webhookSecret: secret,
      actorTokenSecret,
      clock: () => now,
    });
    const event = JSON.stringify({
      type: "post_call_transcription",
      event_timestamp: 1_752_000_000,
      data: {
        agent_id: "agent-1",
        conversation_id: "conversation-transcript",
        status: "done",
        transcript: [
          {
            role: "agent",
            message: "Hi Sarah, an earlier time opened up.",
            time_in_call_secs: 0,
            tool_calls: null,
          },
          {
            role: "user",
            message: "Yes, please move me to five.",
            time_in_call_secs: 4,
            tool_results: null,
          },
        ],
        metadata: { private_provider_field: "must-not-persist" },
        conversation_initiation_client_data: {
          dynamic_variables: { customer_id: "sarah", offer_id: "" },
        },
        has_audio: false,
      },
    });

    const first = await service.handlePostCall(event, signedWebhook(event, secret));
    const duplicate = await service.handlePostCall(event, signedWebhook(event, secret));

    expect(first).toEqual({ status: "processed" });
    expect(duplicate).toEqual({ status: "duplicate" });
    const snapshot = await store.read();
    expect(snapshot.conversations).toContainEqual(expect.objectContaining({
      customerId: "sarah",
      channel: "voice",
      providerConversationId: "elevenlabs:conversation-transcript",
      state: "completed",
    }));
    const conversation = snapshot.conversations.find(
      (entry) => entry.providerConversationId === "elevenlabs:conversation-transcript",
    );
    expect(snapshot.conversationEvents
      .filter((turn) => turn.conversationId === conversation?.id)
      .map((turn) => ({
      text: turn.text,
      direction: turn.direction,
      speaker: turn.speaker,
      metadata: turn.metadata,
      }))).toEqual([
      {
        text: "Hi Sarah, an earlier time opened up.",
        direction: "outbound",
        speaker: "agent",
        metadata: { timeInCallSeconds: 0 },
      },
      {
        text: "Yes, please move me to five.",
        direction: "inbound",
        speaker: "customer",
        metadata: { timeInCallSeconds: 4 },
      },
    ]);
    expect(JSON.stringify(snapshot.conversationEvents)).not.toContain("must-not-persist");
  });
});

describe("ElevenLabsOutboundClient", () => {
  it("starts a Twilio call with dynamic offer context and recording disabled", async () => {
    let captured: { headers?: HeadersInit; body?: Record<string, unknown> } = {};
    const client = new ElevenLabsOutboundClient({
      apiKey: "test-key",
      agentId: "agent-1",
      phoneNumberId: "phone-1",
      fetchImpl: async (_input, init) => {
        captured = {
          ...(init?.headers === undefined ? {} : { headers: init.headers }),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        return new Response(JSON.stringify({
          success: true,
          message: "call started",
          conversation_id: "conversation-1",
          callSid: "CA123",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await client.startCall({
      idempotencyKey: "offer-sarah",
      to: "+14165550101",
      context: {
        customer: { id: "sarah", name: "Sarah" },
        offer: {
          id: "offer-sarah",
          message: "An earlier chair just opened.",
          expiresAt: "2026-07-18T18:00:00.000Z",
          discountPercent: 0,
        },
        appointment: {
          barberName: "Jeremy",
          serviceName: "Signature haircut",
          currentTime: "Monday at 6:00 PM",
          proposedTime: "Monday at 5:00 PM",
          summary: "Current appointment is Monday at 6:00 PM.",
        },
        timezone,
        actorToken: "signed-token",
      },
    });

    expect(result).toEqual({
      provider: "elevenlabs",
      conversationId: "conversation-1",
      providerCallId: "CA123",
    });
    expect(captured.body).toMatchObject({
      agent_id: "agent-1",
      agent_phone_number_id: "phone-1",
      to_number: "+14165550101",
      call_recording_enabled: false,
      conversation_initiation_client_data: {
        dynamic_variables: expect.objectContaining({
          request_id: "offer-sarah",
          offer_id: "offer-sarah",
          customer_id: "sarah",
        }),
      },
    });
    expect(captured.headers).toMatchObject({ "xi-api-key": "test-key" });
  });

  it("accepts a successful provider response without an optional Twilio call id", async () => {
    const client = new ElevenLabsOutboundClient({
      apiKey: "test-key",
      agentId: "agent-1",
      phoneNumberId: "phone-1",
      fetchImpl: async () => new Response(JSON.stringify({
        success: true,
        conversation_id: "conversation-without-call-sid",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    await expect(client.startCall({
      idempotencyKey: "offer-1",
      to: "+14165550101",
      context: {
        customer: { id: "customer-1", name: "Customer" },
        offer: {
          id: "offer-1",
          message: "An appointment opened up.",
          expiresAt: "2026-07-18T18:00:00.000Z",
          discountPercent: 0,
        },
        appointment: {
          barberName: "Jeremy",
          serviceName: "Signature haircut",
          currentTime: null,
          proposedTime: "Monday at 5:00 PM",
          summary: "No appointment is being moved.",
        },
        timezone,
        actorToken: "signed-token",
      },
    })).resolves.toEqual({
      provider: "elevenlabs",
      conversationId: "conversation-without-call-sid",
    });
  });
});
