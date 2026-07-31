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
    expect(config.telegramLocalPolling).toBe(false);
    expect(config.telegramApiIp).toBeUndefined();
    expect(config.backboardApiIp).toBeUndefined();
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

  it("accepts only an E.164 Sarah destination when one is configured", () => {
    expect(loadConfig({ SARAH_PHONE: "" }).sarahPhone).toBeUndefined();
    expect(loadConfig({ SARAH_PHONE: "+14165550101" }).sarahPhone).toBe("+14165550101");
    expect(() => loadConfig({ SARAH_PHONE: "416-555-0101" })).toThrow();
  });

  it("derives a provider actor secret without admin-session configuration", () => {
    const config = loadConfig({ ELEVENLABS_WEBHOOK_SECRET: "voice-secret" });

    expect(config.voiceActorSecret).toBe("voice-secret");
    expect("demoAdminPin" in config).toBe(false);
    expect("adminSessionSecret" in config).toBe(false);
    expect(loadConfig({}).voiceActorSecret).toEqual(expect.any(String));
    expect(loadConfig({}).voiceActorSecret.length).toBeGreaterThan(0);
  });
});
