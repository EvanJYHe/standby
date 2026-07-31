import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "./config.js";
import { createTelegramLinkToken } from "./providers/telegram.js";
import { createRuntime, type StandbyRuntime } from "./runtime.js";

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
  mongoDatabase: "standby_runtime_test",
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

describe("Standby runtime", () => {
  let runtime: StandbyRuntime | undefined;
  let staticRoot: string | undefined;

  afterEach(async () => {
    await runtime?.close();
    if (staticRoot !== undefined) await rm(staticRoot, { recursive: true, force: true });
  });

  it("boots a seeded memory-backed service with an idle worker lifecycle", async () => {
    runtime = await createRuntime(config, { clock: () => now, workerIntervalMs: 10 });

    const health = await runtime.app.inject({ method: "GET", url: "/health" });
    const calendar = await runtime.app.inject({
      method: "GET",
      url: "/api/v1/calendar?date=2026-07-20",
    });

    expect(runtime.storeKind).toBe("memory");
    expect(runtime.workerEnabled).toBe(false);
    expect(health.json()).toMatchObject({ status: "ok", providers: { mongodb: "memory" } });
    expect(calendar.json()).toMatchObject({
      appointments: expect.arrayContaining([
        expect.objectContaining({ customerName: "Josh", status: "confirmed" }),
        expect.objectContaining({ customerName: "Sarah", status: "confirmed" }),
      ]),
    });
  });

  it("serves the built React shell and preserves API 404s", async () => {
    staticRoot = await mkdtemp(join(tmpdir(), "standby-static-"));
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>Standby board</title>");
    runtime = await createRuntime(config, { clock: () => now, staticRoot });

    const page = await runtime.app.inject({ method: "GET", url: "/" });
    const missingApi = await runtime.app.inject({ method: "GET", url: "/api/v1/missing" });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Standby board");
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers["content-type"]).toContain("application/json");
  });

  it("idempotently registers the production Telegram webhook", async () => {
    const fetchImpl = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    runtime = await createRuntime({
      ...config,
      nodeEnv: "production",
      publicBaseUrl: "https://standby.example",
      telegramBotToken: "test-bot-token",
      telegramWebhookSecret: "test-webhook-secret",
    }, { clock: () => now, fetchImpl });

    const result = await runtime.configureWebhooks();

    expect(result).toEqual({ telegram: "registered" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0];
    expect(String(request?.[0])).toContain("/setWebhook");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      url: "https://standby.example/webhooks/telegram",
      secret_token: "test-webhook-secret",
      allowed_updates: ["message"],
    });
  });

  it("polls Telegram locally without requiring a public webhook", async () => {
    const telegramSecret = "local-polling-secret";
    let pollingRequests = 0;
    const urls: string[] = [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/deleteWebhook")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/getUpdates")) {
        pollingRequests += 1;
        if (pollingRequests === 1) {
          return new Response(JSON.stringify({
            ok: true,
            result: [{
              update_id: 501,
              message: {
                message_id: 10,
                chat: { id: 9001 },
                text: `/start ${createTelegramLinkToken("josh", telegramSecret)}`,
              },
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      if (url.includes("/sendMessage")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    });
    runtime = await createRuntime({
      ...config,
      nodeEnv: "development",
      telegramBotToken: "test-bot-token",
      telegramWebhookSecret: telegramSecret,
      telegramLocalPolling: true,
      backboardApiKey: "backboard-key",
      backboardAssistantId: "assistant-id",
    }, { clock: () => now, fetchImpl });

    await expect(runtime.configureWebhooks()).resolves.toEqual({ telegram: "polling" });
    await vi.waitFor(async () => {
      expect((await runtime!.store.read()).customers.find((customer) => customer.id === "josh")?.telegramChatId)
        .toBe("9001");
    });
    expect(urls.some((url) => url.includes("/deleteWebhook"))).toBe(true);
    expect(urls.some((url) => url.includes("/getUpdates"))).toBe(true);
    expect(urls.some((url) => url.includes("/sendMessage"))).toBe(true);
  });
});
