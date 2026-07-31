import { access } from "node:fs/promises";
import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { MongoClient } from "mongodb";

import { StandbyEngine } from "../domain/engine.js";
import { InMemoryStore, type StandbyStore } from "../domain/store.js";
import { RefillWorker } from "../domain/worker.js";
import { buildServer } from "./app.js";
import type { AppConfig } from "./config.js";
import { MongoStandbyStore } from "./mongo-store.js";
import { BackboardClient } from "./providers/backboard.js";
import {
  ElevenLabsOutboundClient,
  ElevenLabsWebhookService,
} from "./providers/elevenlabs.js";
import { ProviderOfferSender } from "./providers/offer-sender.js";
import { SchedulingToolbox } from "./providers/scheduling-tools.js";
import { TelegramApiClient, TelegramWebhookHandler } from "./providers/telegram.js";
import { createDemoState } from "./seed.js";

interface RuntimeOptions {
  clock?: () => string;
  fetchImpl?: typeof fetch;
  staticRoot?: string;
  workerIntervalMs?: number;
}

interface StoreHandle {
  store: StandbyStore;
  kind: "memory" | "mongodb";
  close: () => Promise<void>;
  fallbackReason?: string;
}

export interface StandbyRuntime {
  app: FastifyInstance;
  store: StandbyStore;
  engine: StandbyEngine;
  storeKind: "memory" | "mongodb";
  workerEnabled: boolean;
  configureWebhooks(): Promise<{ telegram: "registered" | "polling" | "skipped" | "failed" }>;
  startWorker(): void;
  close(): Promise<void>;
}

async function openStore(config: AppConfig, clock: () => string): Promise<StoreHandle> {
  const seed = createDemoState({
    now: clock(),
    timezone: config.timezone,
    ...(config.sarahPhone === undefined ? {} : {
      preservedIdentities: { sarahPhone: config.sarahPhone },
    }),
  });
  const memory = (fallbackReason?: string): StoreHandle => ({
    store: new InMemoryStore(seed),
    kind: "memory",
    close: async () => undefined,
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  });

  if (config.dataStore === "memory") return memory();
  if (config.mongoUri === undefined) {
    if (config.dataStore === "mongodb") {
      throw new Error("DATA_STORE=mongodb requires MONGODB_URI.");
    }
    return memory();
  }

  const client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    appName: "standby-scheduling-operator",
  });
  try {
    await client.connect();
    await client.db(config.mongoDatabase).command({ ping: 1 });
    const store = new MongoStandbyStore(client, config.mongoDatabase);
    await store.initialize(seed);
    return { store, kind: "mongodb", close: () => client.close() };
  } catch (error) {
    await client.close().catch(() => undefined);
    if (config.dataStore === "auto" && config.nodeEnv !== "production") {
      return memory(error instanceof Error ? error.name : "MongoConnectionError");
    }
    throw error;
  }
}

async function registerStaticShell(app: FastifyInstance, staticRoot: string): Promise<void> {
  await access(join(staticRoot, "index.html"));
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: "/",
    index: ["index.html"],
  });
  app.setNotFoundHandler((request, reply) => {
    const isServiceRoute = request.url === "/health"
      || request.url.startsWith("/api/")
      || request.url.startsWith("/webhooks/");
    if (request.method === "GET" && !isServiceRoute) return reply.sendFile("index.html");
    return reply.status(404).send({ error: "not_found" });
  });
}

export async function createRuntime(
  config: AppConfig,
  options: RuntimeOptions = {},
): Promise<StandbyRuntime> {
  const clock = options.clock ?? (() => new Date().toISOString());
  const storeHandle = await openStore(config, clock);
  const configuredSarahPhone = config.sarahPhone;
  if (configuredSarahPhone !== undefined) {
    const current = await storeHandle.store.read();
    const sarah = current.customers.find((customer) => customer.id === "sarah");
    if (
      sarah !== undefined
      && (
        sarah.phone !== configuredSarahPhone
        || sarah.contactPreference !== "voice"
        || !sarah.earlierMoveConsent
        || !sarah.pastCustomerOptIn
      )
    ) {
      await storeHandle.store.transaction((state) => {
        const recipient = state.customers.find((customer) => customer.id === "sarah");
        if (recipient === undefined) return;
        recipient.phone = configuredSarahPhone;
        recipient.contactPreference = "voice";
        recipient.earlierMoveConsent = true;
        recipient.pastCustomerOptIn = true;
        recipient.updatedAt = clock();
      });
    }
  }
  const engine = new StandbyEngine(storeHandle.store);
  const toolbox = new SchedulingToolbox(storeHandle.store, engine, clock);

  const backboard = config.backboardApiKey === undefined || config.backboardAssistantId === undefined
    ? undefined
    : new BackboardClient({
        apiKey: config.backboardApiKey,
        assistantId: config.backboardAssistantId,
        ...(config.backboardApiIp === undefined ? {} : { apiIp: config.backboardApiIp }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
  const telegram = config.telegramBotToken === undefined
    ? undefined
    : new TelegramApiClient({
        botToken: config.telegramBotToken,
        ...(config.telegramApiIp === undefined ? {} : { apiIp: config.telegramApiIp }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
  const telegramWebhook = backboard === undefined
    || telegram === undefined
    || config.telegramWebhookSecret === undefined
      ? undefined
      : new TelegramWebhookHandler({
          store: storeHandle.store,
          backboard,
          toolbox,
          transport: telegram,
          linkSecret: config.telegramWebhookSecret,
          clock,
        });
  const elevenLabsWebhooks = config.elevenLabsAgentId === undefined
    || config.elevenLabsWebhookSecret === undefined
      ? undefined
      : new ElevenLabsWebhookService({
          store: storeHandle.store,
          engine,
          toolbox,
          agentId: config.elevenLabsAgentId,
          webhookSecret: config.elevenLabsWebhookSecret,
          clock,
        });
  const elevenLabsOutbound = config.elevenLabsApiKey === undefined
    || config.elevenLabsAgentId === undefined
    || config.elevenLabsPhoneNumberId === undefined
      ? undefined
      : new ElevenLabsOutboundClient({
          apiKey: config.elevenLabsApiKey,
          agentId: config.elevenLabsAgentId,
          phoneNumberId: config.elevenLabsPhoneNumberId,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        });
  const worker = backboard === undefined || telegram === undefined
    ? undefined
    : new RefillWorker(
        storeHandle.store,
        new ProviderOfferSender({
          store: storeHandle.store,
          backboard,
          telegram,
          ...(elevenLabsOutbound === undefined ? {} : { elevenLabs: elevenLabsOutbound }),
          voiceTokenSecret: config.voiceActorSecret,
          clock,
        }),
        {
          workerId: `standby-${process.pid}`,
          ...(configuredSarahPhone === undefined ? {} : { priorityVoiceCustomerId: "sarah" }),
        },
      );

  const app = await buildServer({
    config,
    store: storeHandle.store,
    engine,
    storeKind: storeHandle.kind,
    clock,
    ...(telegramWebhook === undefined ? {} : { telegramWebhook }),
    ...(elevenLabsWebhooks === undefined ? {} : { elevenLabsWebhooks }),
  });
  if (storeHandle.fallbackReason !== undefined) {
    app.log.warn(
      { reason: storeHandle.fallbackReason },
      "MongoDB was unavailable; using an in-memory development store",
    );
  }
  if (options.staticRoot !== undefined) await registerStaticShell(app, options.staticRoot);

  let workerTimer: NodeJS.Timeout | undefined;
  let workerRunning = false;
  let telegramPollingController: AbortController | undefined;
  let telegramPollingTask: Promise<void> | undefined;
  let closed = false;
  const tick = async () => {
    if (worker === undefined || workerRunning || closed) return;
    workerRunning = true;
    try {
      const result = await worker.runOnce(clock());
      if (result.status !== "idle") app.log.info({ result }, "refill worker advanced");
    } catch (error) {
      app.log.error(
        { error: error instanceof Error ? error.name : "WorkerError" },
        "refill worker tick failed",
      );
    } finally {
      workerRunning = false;
    }
  };
  const startWorker = () => {
    if (worker === undefined || workerTimer !== undefined || closed) return;
    void tick();
    workerTimer = setInterval(() => void tick(), options.workerIntervalMs ?? 1_000);
  };

  const startTelegramPolling = async (): Promise<{ telegram: "polling" | "failed" }> => {
    if (telegramPollingTask !== undefined) return { telegram: "polling" };
    if (telegram === undefined || telegramWebhook === undefined) return { telegram: "failed" };
    telegramPollingController = new AbortController();
    const signal = telegramPollingController.signal;
    telegramPollingTask = (async () => {
      let offset: number | undefined;
      let webhookRemoved = false;
      app.log.info("Telegram local polling worker started");
      while (!signal.aborted && !closed) {
        try {
          if (!webhookRemoved) {
            await telegram.deleteWebhook(false);
            webhookRemoved = true;
            app.log.info("Telegram remote webhook removed; receiving updates locally");
          }
          const updates = await telegram.getUpdates(offset, 25, signal);
          for (const update of updates) {
            offset = Math.max(offset ?? 0, update.update_id + 1);
            try {
              await telegramWebhook.handle(update);
            } catch (error) {
              app.log.error(
                {
                  updateId: update.update_id,
                  error: error instanceof Error ? error.name : "TelegramUpdateError",
                },
                "Telegram local update failed",
              );
            }
          }
        } catch (error) {
          if (signal.aborted || closed) break;
          app.log.error(
            { error: error instanceof Error ? error.message : "TelegramPollingError" },
            "Telegram local polling failed; retrying",
          );
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1_000);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
      }
    })();
    return { telegram: "polling" };
  };

  const configureWebhooks = async () => {
    if (config.nodeEnv !== "production" && config.telegramLocalPolling) {
      return startTelegramPolling();
    }
    const publicUrl = new URL(config.publicBaseUrl);
    if (
      telegram === undefined
      || config.telegramWebhookSecret === undefined
      || config.nodeEnv !== "production"
      || publicUrl.protocol !== "https:"
    ) {
      return { telegram: "skipped" as const };
    }
    try {
      await telegram.setWebhook(
        new URL("/webhooks/telegram", publicUrl).toString(),
        config.telegramWebhookSecret,
      );
      app.log.info("Telegram webhook registered");
      return { telegram: "registered" as const };
    } catch (error) {
      app.log.error(
        { error: error instanceof Error ? error.name : "WebhookRegistrationError" },
        "Telegram webhook registration failed",
      );
      return { telegram: "failed" as const };
    }
  };

  return {
    app,
    store: storeHandle.store,
    engine,
    storeKind: storeHandle.kind,
    workerEnabled: worker !== undefined,
    configureWebhooks,
    startWorker,
    close: async () => {
      if (closed) return;
      closed = true;
      if (workerTimer !== undefined) clearInterval(workerTimer);
      telegramPollingController?.abort();
      await telegramPollingTask?.catch(() => undefined);
      await telegram?.close();
      await backboard?.close();
      await app.close();
      await storeHandle.close();
    },
  };
}
