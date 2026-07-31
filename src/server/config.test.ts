import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("parses the explicit store mode and defaults safe demo settings", () => {
    const config = loadConfig({ DATA_STORE: "memory", DEMO_MODE: "true" });

    expect(config.dataStore).toBe("memory");
    expect(config.port).toBe(3100);
    expect(config.publicBaseUrl).toBe("http://127.0.0.1:3100");
    expect(config.timezone).toBe("America/Toronto");
    expect(config.demoMode).toBe(true);
    expect(config.outreachWorkerEnabled).toBe(false);
    expect(config.voiceAgent).toEqual({ provider: "disabled", outboundEnabled: false });
    expect(config.telegramLocalPolling).toBe(false);
    expect(config.telegramApiIp).toBeUndefined();
    expect(config.backboardApiIp).toBeUndefined();
    expect(config.googleOAuthClientId).toBeUndefined();
  });

  it("accepts the public Google OAuth web client ID without any client secret", () => {
    const config = loadConfig({
      GOOGLE_OAUTH_CLIENT_ID: "standby.apps.googleusercontent.com",
    });

    expect(config.googleOAuthClientId).toBe("standby.apps.googleusercontent.com");
    expect("googleOAuthClientSecret" in config).toBe(false);
  });

  it("enables explicit local Telegram polling", () => {
    expect(loadConfig({ TELEGRAM_LOCAL_POLLING: "true" }).telegramLocalPolling).toBe(true);
  });

  it("accepts an optional Telegram API IP override", () => {
    expect(loadConfig({ TELEGRAM_API_IP: "149.154.166.110" }).telegramApiIp)
      .toBe("149.154.166.110");
    expect(() => loadConfig({ TELEGRAM_API_IP: "not-an-ip" })).toThrow();
  });

  it("accepts an optional Backboard API IP override", () => {
    expect(loadConfig({ BACKBOARD_API_IP: "15.222.100.239" }).backboardApiIp)
      .toBe("15.222.100.239");
    expect(() => loadConfig({ BACKBOARD_API_IP: "not-an-ip" })).toThrow();
  });

  it("rejects an unknown persistence mode", () => {
    expect(() => loadConfig({ DATA_STORE: "spreadsheet" })).toThrow();
  });

  it("rejects partial provider configuration instead of constructing half an adapter", () => {
    expect(() => loadConfig({
      VOICE_PROVIDER: "elevenlabs",
      ELEVENLABS_AGENT_ID: "agent-1",
    })).toThrow();
    expect(loadConfig({ ELEVENLABS_AGENT_ID: "ignored-until-opted-in" }).voiceAgent)
      .toEqual({ provider: "disabled", outboundEnabled: false });
    expect(() => loadConfig({ VOICE_OUTBOUND_ENABLED: "true" })).toThrow(
      "requires VOICE_PROVIDER=elevenlabs",
    );
  });

  it("supports inbound voice without requiring outbound calling credentials", () => {
    const config = loadConfig({
      VOICE_PROVIDER: "elevenlabs",
      VOICE_ACTOR_TOKEN_SECRET: "voice-actor-secret-that-is-at-least-32-characters",
      ELEVENLABS_AGENT_ID: "agent-1",
      ELEVENLABS_WEBHOOK_SECRET: "voice-webhook-secret",
    });

    expect(config.voiceAgent).toMatchObject({
      provider: "elevenlabs",
      outboundEnabled: false,
      agentId: "agent-1",
    });
    expect("apiKey" in config.voiceAgent).toBe(false);
    expect("phoneNumberId" in config.voiceAgent).toBe(false);
  });

  it("builds an explicit ElevenLabs adapter configuration with independent secrets", () => {
    const config = loadConfig({
      VOICE_PROVIDER: "elevenlabs",
      VOICE_OUTBOUND_ENABLED: "true",
      VOICE_ACTOR_TOKEN_SECRET: "voice-actor-secret-that-is-at-least-32-characters",
      ELEVENLABS_API_KEY: "api-key",
      ELEVENLABS_AGENT_ID: "agent-1",
      ELEVENLABS_PHONE_NUMBER_ID: "phone-1",
      ELEVENLABS_WEBHOOK_SECRET: "voice-webhook-secret",
    });

    expect(config.voiceAgent).toMatchObject({
      provider: "elevenlabs",
      outboundEnabled: true,
      agentId: "agent-1",
      actorTokenSecret: "voice-actor-secret-that-is-at-least-32-characters",
    });
    expect("demoAdminPin" in config).toBe(false);
    expect("adminSessionSecret" in config).toBe(false);
  });
});
