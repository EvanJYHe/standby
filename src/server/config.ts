import { createHash } from "node:crypto";

import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => value === "" ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const optionalE164Phone = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^\+[1-9]\d{7,14}$/, "Expected an E.164 phone number.").optional(),
);
const booleanString = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  return value.toLowerCase() === "true";
}, z.boolean());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  PUBLIC_BASE_URL: z.url().default("http://127.0.0.1:3100"),
  SHOP_TIMEZONE: z.string().min(1).default("America/Toronto"),
  DEMO_MODE: booleanString.default(true),
  DATA_STORE: z.enum(["auto", "memory", "mongodb"]).default("auto"),
  MONGODB_URI: optionalUrl,
  MONGODB_DB: z.string().min(1).default("standby"),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_LOCAL_POLLING: booleanString.default(false),
  TELEGRAM_API_IP: z.preprocess(emptyToUndefined, z.ipv4().optional()),
  BACKBOARD_API_KEY: optionalString,
  BACKBOARD_ASSISTANT_ID: optionalString,
  BACKBOARD_API_IP: z.preprocess(emptyToUndefined, z.ipv4().optional()),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_AGENT_ID: optionalString,
  ELEVENLABS_PHONE_NUMBER_ID: optionalString,
  ELEVENLABS_WEBHOOK_SECRET: optionalString,
  SARAH_PHONE: optionalE164Phone,
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  publicBaseUrl: string;
  timezone: string;
  demoMode: boolean;
  voiceActorSecret: string;
  dataStore: "auto" | "memory" | "mongodb";
  mongoUri: string | undefined;
  mongoDatabase: string;
  telegramBotToken: string | undefined;
  telegramWebhookSecret: string | undefined;
  telegramLocalPolling: boolean;
  telegramApiIp: string | undefined;
  backboardApiKey: string | undefined;
  backboardAssistantId: string | undefined;
  backboardApiIp: string | undefined;
  elevenLabsApiKey: string | undefined;
  elevenLabsAgentId: string | undefined;
  elevenLabsPhoneNumberId: string | undefined;
  elevenLabsWebhookSecret: string | undefined;
  sarahPhone: string | undefined;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const providerSecret = parsed.ELEVENLABS_WEBHOOK_SECRET ?? parsed.TELEGRAM_WEBHOOK_SECRET;
  const voiceActorSecret = providerSecret ?? createHash("sha256")
    .update("standby-local-voice-actor")
    .digest("hex");
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    timezone: parsed.SHOP_TIMEZONE,
    demoMode: parsed.DEMO_MODE,
    voiceActorSecret,
    dataStore: parsed.DATA_STORE,
    mongoUri: parsed.MONGODB_URI,
    mongoDatabase: parsed.MONGODB_DB,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    telegramLocalPolling: parsed.TELEGRAM_LOCAL_POLLING,
    telegramApiIp: parsed.TELEGRAM_API_IP,
    backboardApiKey: parsed.BACKBOARD_API_KEY,
    backboardAssistantId: parsed.BACKBOARD_ASSISTANT_ID,
    backboardApiIp: parsed.BACKBOARD_API_IP,
    elevenLabsApiKey: parsed.ELEVENLABS_API_KEY,
    elevenLabsAgentId: parsed.ELEVENLABS_AGENT_ID,
    elevenLabsPhoneNumberId: parsed.ELEVENLABS_PHONE_NUMBER_ID,
    elevenLabsWebhookSecret: parsed.ELEVENLABS_WEBHOOK_SECRET,
    sarahPhone: parsed.SARAH_PHONE,
  };
}
