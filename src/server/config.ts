import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => value === "" ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
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
  OUTREACH_WORKER_ENABLED: booleanString.default(false),
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
  VOICE_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["disabled", "elevenlabs"]).default("disabled"),
  ),
  VOICE_OUTBOUND_ENABLED: booleanString.default(false),
  VOICE_ACTOR_TOKEN_SECRET: optionalString,
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_AGENT_ID: optionalString,
  ELEVENLABS_PHONE_NUMBER_ID: optionalString,
  ELEVENLABS_WEBHOOK_SECRET: optionalString,
  ELEVENLABS_BASE_URL: optionalUrl,
  ELEVENLABS_REQUEST_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  ),
});

export type VoiceAgentConfig =
  | { provider: "disabled"; outboundEnabled: false }
  | ({
      provider: "elevenlabs";
      agentId: string;
      webhookSecret: string;
      actorTokenSecret: string;
      baseUrl: string;
      requestTimeoutMs: number;
    } & (
      | { outboundEnabled: false; apiKey?: string; phoneNumberId?: string }
      | { outboundEnabled: true; apiKey: string; phoneNumberId: string }
    ));

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  publicBaseUrl: string;
  timezone: string;
  demoMode: boolean;
  outreachWorkerEnabled: boolean;
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
  voiceAgent: VoiceAgentConfig;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const voiceProvider = parsed.VOICE_PROVIDER;
  if (voiceProvider === "disabled" && parsed.VOICE_OUTBOUND_ENABLED) {
    throw new Error("VOICE_OUTBOUND_ENABLED=true requires VOICE_PROVIDER=elevenlabs.");
  }
  const voiceAgent: VoiceAgentConfig = voiceProvider === "disabled"
    ? { provider: "disabled", outboundEnabled: false }
    : (() => {
        const common = z.object({
          agentId: z.string().min(1),
          webhookSecret: z.string().min(16),
          actorTokenSecret: z.string().min(32),
        }).parse({
          agentId: parsed.ELEVENLABS_AGENT_ID,
          webhookSecret: parsed.ELEVENLABS_WEBHOOK_SECRET,
          actorTokenSecret: parsed.VOICE_ACTOR_TOKEN_SECRET,
        });
        const base = {
          provider: "elevenlabs" as const,
          ...common,
          baseUrl: parsed.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io",
          requestTimeoutMs: parsed.ELEVENLABS_REQUEST_TIMEOUT_MS,
        };
        if (!parsed.VOICE_OUTBOUND_ENABLED) {
          return {
            ...base,
            outboundEnabled: false as const,
            ...(parsed.ELEVENLABS_API_KEY === undefined ? {} : { apiKey: parsed.ELEVENLABS_API_KEY }),
            ...(parsed.ELEVENLABS_PHONE_NUMBER_ID === undefined
              ? {}
              : { phoneNumberId: parsed.ELEVENLABS_PHONE_NUMBER_ID }),
          };
        }
        const outbound = z.object({
          apiKey: z.string().min(1),
          phoneNumberId: z.string().min(1),
        }).parse({
          apiKey: parsed.ELEVENLABS_API_KEY,
          phoneNumberId: parsed.ELEVENLABS_PHONE_NUMBER_ID,
        });
        return { ...base, ...outbound, outboundEnabled: true as const };
      })();
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    timezone: parsed.SHOP_TIMEZONE,
    demoMode: parsed.DEMO_MODE,
    outreachWorkerEnabled: parsed.OUTREACH_WORKER_ENABLED,
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
    voiceAgent,
  };
}
