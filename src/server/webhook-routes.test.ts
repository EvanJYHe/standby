import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StandbyEngine } from "../domain/engine.js";
import { InMemoryStore } from "../domain/store.js";
import { buildServer } from "./app.js";
import type { AppConfig } from "./config.js";
import { createDemoState } from "./seed.js";
import type { BackboardClient } from "./providers/backboard.js";
import { ElevenLabsWebhookService } from "./providers/elevenlabs.js";
import { SchedulingToolbox } from "./providers/scheduling-tools.js";
import {
  createTelegramLinkToken,
  TelegramWebhookHandler,
  type TelegramTransport,
} from "./providers/telegram.js";

const now = "2026-07-18T16:00:00.000Z";
const telegramSecret = "telegram-webhook-secret";
const voiceSecret = "voice-webhook-secret-that-is-long-enough";
const config: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  publicBaseUrl: "http://localhost:3000",
  timezone: "America/Toronto",
  demoMode: true,
  voiceActorSecret: voiceSecret,
  dataStore: "memory",
  mongoUri: undefined,
  mongoDatabase: "standby_test",
  telegramBotToken: "telegram-token",
  telegramWebhookSecret: telegramSecret,
  telegramLocalPolling: false,
  telegramApiIp: undefined,
  backboardApiKey: "backboard-key",
  backboardAssistantId: "assistant-1",
  backboardApiIp: undefined,
  elevenLabsApiKey: "elevenlabs-key",
  elevenLabsAgentId: "agent-1",
  elevenLabsPhoneNumberId: "phone-1",
  elevenLabsWebhookSecret: voiceSecret,
  sarahPhone: "+14165550101",
};

describe("provider webhook routes", () => {
  let store: InMemoryStore;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const messages: string[] = [];

  beforeEach(async () => {
    messages.length = 0;
    store = new InMemoryStore(createDemoState({
      now,
      timezone: config.timezone,
      preservedIdentities: { sarahPhone: "+14165550101" },
    }));
    const engine = new StandbyEngine(store);
    const toolbox = new SchedulingToolbox(store, engine, () => now);
    const backboard = {
      reply: async () => ({ content: "Backboard reply", threadId: "thread-1" }),
    } as unknown as BackboardClient;
    const transport: TelegramTransport = {
      sendMessage: async (_chatId, text) => {
        messages.push(text);
        return { providerMessageId: "message-1" };
      },
    };
    const telegram = new TelegramWebhookHandler({
      store,
      backboard,
      toolbox,
      transport,
      linkSecret: telegramSecret,
      clock: () => now,
    });
    const elevenLabs = new ElevenLabsWebhookService({
      store,
      engine,
      toolbox,
      agentId: "agent-1",
      webhookSecret: voiceSecret,
      clock: () => now,
    });
    app = await buildServer({
      config,
      store,
      engine,
      clock: () => now,
      telegramWebhook: telegram,
      elevenLabsWebhooks: elevenLabs,
    });
  });

  afterEach(async () => app.close());

  it("validates Telegram's secret header before linking a demo identity", async () => {
    const payload = {
      update_id: 101,
      message: {
        message_id: 1,
        chat: { id: 1001 },
        text: `/start ${createTelegramLinkToken("josh", telegramSecret)}`,
      },
    };
    const denied = await app.inject({ method: "POST", url: "/webhooks/telegram", payload });
    expect(denied.statusCode).toBe(401);

    const accepted = await app.inject({
      method: "POST",
      url: "/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": telegramSecret },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ ok: true, status: "processed" });
    expect((await store.read()).customers.find((customer) => customer.id === "josh")?.telegramChatId).toBe("1001");
  });

  it("authenticates and validates inbound ElevenLabs context", async () => {
    const payload = {
      caller_id: "+14165550101",
      agent_id: "agent-1",
      called_number: "+14165550000",
      call_sid: "CA123",
    };
    const denied = await app.inject({
      method: "POST",
      url: "/webhooks/elevenlabs/context",
      payload,
    });
    expect(denied.statusCode).toBe(401);

    const accepted = await app.inject({
      method: "POST",
      url: "/webhooks/elevenlabs/context",
      headers: { "x-standby-webhook-secret": voiceSecret },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      type: "conversation_initiation_client_data",
      dynamic_variables: { customer_name: "Sarah", secret__actor_token: expect.any(String) },
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/webhooks/elevenlabs/context",
      headers: { "x-standby-webhook-secret": voiceSecret },
      payload: { ...payload, caller_id: 123 },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("rejects unsigned post-call events without processing them", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/elevenlabs/post-call",
      payload: {
        type: "call_initiation_failure",
        event_timestamp: 1,
        data: { agent_id: "agent-1", conversation_id: "conversation-1", failure_reason: "no-answer" },
      },
    });

    expect(response.statusCode).toBe(401);
    expect((await store.read()).processedEvents).toHaveLength(0);
  });
});
