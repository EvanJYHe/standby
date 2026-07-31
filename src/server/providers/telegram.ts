import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { DateTime } from "luxon";
import { Agent } from "undici";
import { z } from "zod";

import type { StandbyStore } from "../../domain/store.js";
import { recordConversationEvent } from "../conversations.js";
import type { BackboardClient } from "./backboard.js";
import type { SchedulingToolbox } from "./scheduling-tools.js";

const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    message_id: z.number().int(),
    chat: z.object({ id: z.union([z.number(), z.string()]) }),
    text: z.string().optional(),
  }).optional(),
}).passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface TelegramTransport {
  sendMessage(chatId: string, text: string): Promise<{ providerMessageId: string }>;
}

interface TelegramApiClientOptions {
  botToken: string;
  fetchImpl?: typeof fetch;
  apiIp?: string;
}

export class TelegramApiClient implements TelegramTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly dispatcher: Agent | undefined;

  constructor(private readonly options: TelegramApiClientOptions) {
    this.dispatcher = options.fetchImpl === undefined && options.apiIp !== undefined
      ? new Agent({
          connect: {
            lookup: (_hostname, lookupOptions, callback) => {
              if (lookupOptions.all) {
                callback(null, [{ address: options.apiIp!, family: 4 }]);
                return;
              }
              callback(null, options.apiIp!, 4);
            },
          },
        })
      : undefined;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, {
      ...init,
      ...(this.dispatcher === undefined ? {} : { dispatcher: this.dispatcher }),
    } as RequestInit));
  }

  async close(): Promise<void> {
    await this.dispatcher?.close();
  }

  async sendMessage(chatId: string, text: string): Promise<{ providerMessageId: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.telegram.org/bot${this.options.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(12_000),
        },
      );
    } catch {
      throw new Error("Telegram delivery failed.");
    }
    const payload = z.object({
      ok: z.boolean(),
      result: z.object({ message_id: z.number() }).optional(),
    }).passthrough().safeParse(await response.json().catch(() => ({})));
    if (!response.ok || !payload.success || !payload.data.ok || payload.data.result === undefined) {
      throw new Error("Telegram delivery failed.");
    }
    return { providerMessageId: String(payload.data.result.message_id) };
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    const response = await this.fetchImpl(
      `https://api.telegram.org/bot${this.options.botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) throw new Error("Telegram webhook registration failed.");
  }

  async deleteWebhook(dropPendingUpdates = false): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.telegram.org/bot${this.options.botToken}/deleteWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drop_pending_updates: dropPendingUpdates }),
          signal: AbortSignal.timeout(12_000),
        },
      );
    } catch {
      throw new Error("Telegram webhook removal failed.");
    }
    const payload = z.object({ ok: z.boolean() }).passthrough()
      .safeParse(await response.json().catch(() => ({})));
    if (!response.ok || !payload.success || !payload.data.ok) {
      throw new Error("Telegram webhook removal failed.");
    }
  }

  async getUpdates(
    offset: number | undefined,
    timeoutSeconds: number,
    signal: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.telegram.org/bot${this.options.botToken}/getUpdates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(offset === undefined ? {} : { offset }),
            timeout: timeoutSeconds,
            allowed_updates: ["message"],
          }),
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout((timeoutSeconds + 5) * 1_000),
          ]),
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error("Telegram polling failed.");
    }
    const payload = z.object({
      ok: z.boolean(),
      result: z.array(telegramUpdateSchema).optional(),
    }).passthrough().safeParse(await response.json().catch(() => ({})));
    if (!response.ok || !payload.success || !payload.data.ok || payload.data.result === undefined) {
      throw new Error("Telegram polling failed.");
    }
    return payload.data.result;
  }
}

function linkSignature(customerId: string, secret: string): string {
  return createHmac("sha256", secret).update(`telegram-link:${customerId}`).digest("base64url").slice(0, 16);
}

export function createTelegramLinkToken(customerId: string, secret: string): string {
  return `standby_${customerId}_${linkSignature(customerId, secret)}`;
}

function customerFromLinkToken(token: string, secret: string): string | undefined {
  const match = /^standby_([a-z0-9-]+)_([A-Za-z0-9_-]{16})$/.exec(token);
  if (match === null) return undefined;
  const customerId = match[1]!;
  const supplied = Buffer.from(match[2]!);
  const expected = Buffer.from(linkSignature(customerId, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  return customerId;
}

interface TelegramWebhookHandlerOptions {
  store: StandbyStore;
  backboard: BackboardClient;
  toolbox: SchedulingToolbox;
  transport: TelegramTransport;
  linkSecret: string;
  clock?: () => string;
  idFactory?: () => string;
}

export class TelegramWebhookHandler {
  private readonly clock: () => string;
  private readonly makeId: () => string;

  constructor(private readonly options: TelegramWebhookHandlerOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.makeId = options.idFactory ?? randomUUID;
  }

  async handle(payload: unknown): Promise<{ status: "processed" | "duplicate" | "ignored" }> {
    const update = telegramUpdateSchema.parse(payload);
    const duplicate = await this.options.store.transaction((state) => {
      if (state.processedEvents.some(
        (event) => event.provider === "telegram" && event.eventId === String(update.update_id),
      )) return true;
      state.processedEvents.push({
        id: this.makeId(),
        provider: "telegram",
        eventId: String(update.update_id),
        processedAt: this.clock(),
      });
      return false;
    });
    if (duplicate) return { status: "duplicate" };

    const message = update.message;
    if (message?.text === undefined) return { status: "ignored" };
    const chatId = String(message.chat.id);
    const startMatch = /^\/start(?:@\w+)?(?:\s+(.+))?$/.exec(message.text.trim());
    if (startMatch !== null) {
      await this.handleStart(chatId, startMatch[1]);
      return { status: "processed" };
    }

    const state = await this.options.store.read();
    const customer = state.customers.find((candidate) => candidate.telegramChatId === chatId);
    if (customer === undefined) {
      await this.options.transport.sendMessage(
        chatId,
        "This Telegram account is not linked to a Standby demo customer. Please use your private demo link.",
      );
      return { status: "processed" };
    }
    const thread = state.backboardThreads.find((candidate) => candidate.customerId === customer.id);
    const activeOffer = state.offers.find(
      (offer) => offer.customerId === customer.id && ["pending", "delivered"].includes(offer.status),
    );
    const content = activeOffer === undefined
      ? message.text
      : [
          `Customer message: ${message.text}`,
          "Private live scheduling context for tool use only (never quote internal IDs):",
          `Active offer: ${activeOffer.id}`,
          `Proposed local time: ${DateTime.fromISO(activeOffer.proposedStartAt).setZone(state.settings.timezone).toFormat("cccc, LLLL d 'at' h:mm a")}`,
        ].join("\n");

    await recordConversationEvent(this.options.store, {
      customerId: customer.id,
      channel: "telegram",
      conversationDirection: "inbound",
      providerConversationId: chatId,
      providerEventId: `telegram:update:${update.update_id}`,
      kind: "message",
      direction: "inbound",
      speaker: "customer",
      text: message.text,
      ...(activeOffer === undefined ? {} : {
        offerId: activeOffer.id,
        refillJobId: activeOffer.jobId,
      }),
      occurredAt: this.clock(),
    });

    try {
      const response = await this.options.backboard.reply({
        content,
        ...(thread === undefined ? {} : { threadId: thread.threadId }),
        actor: { provider: "telegram", customerId: customer.id, providerEventId: String(update.update_id) },
        tools: this.options.toolbox.definitions,
        executeTool: (name, argumentsValue, actor) => this.options.toolbox.execute(name, argumentsValue, actor),
      });
      if (thread === undefined) {
        await this.options.store.transaction((draft) => {
          const existing = draft.backboardThreads.find((candidate) => candidate.customerId === customer.id);
          if (existing !== undefined) {
            existing.threadId = response.threadId;
            existing.updatedAt = this.clock();
          } else {
            draft.backboardThreads.push({
              id: this.makeId(),
              customerId: customer.id,
              threadId: response.threadId,
              createdAt: this.clock(),
              updatedAt: this.clock(),
            });
          }
        });
      }
      const delivered = await this.options.transport.sendMessage(chatId, response.content);
      await recordConversationEvent(this.options.store, {
        customerId: customer.id,
        channel: "telegram",
        conversationDirection: "inbound",
        providerConversationId: chatId,
        providerEventId: `telegram:message:${delivered.providerMessageId}`,
        kind: "message",
        direction: "outbound",
        speaker: "agent",
        text: response.content,
        deliveryState: "delivered",
        ...(activeOffer === undefined ? {} : {
          offerId: activeOffer.id,
          refillJobId: activeOffer.jobId,
        }),
        occurredAt: this.clock(),
      });
    } catch {
      const safeMessage = "Standby is having trouble reaching the scheduling assistant right now. Your appointments have not been changed.";
      await this.options.transport.sendMessage(
        chatId,
        safeMessage,
      );
      await recordConversationEvent(this.options.store, {
        customerId: customer.id,
        channel: "telegram",
        conversationDirection: "inbound",
        providerConversationId: chatId,
        providerEventId: `telegram:error:${update.update_id}`,
        kind: "error",
        speaker: "system",
        text: "Standby could not reach the scheduling assistant. No appointment was changed.",
        deliveryState: "failed",
        ...(activeOffer === undefined ? {} : {
          offerId: activeOffer.id,
          refillJobId: activeOffer.jobId,
        }),
        occurredAt: this.clock(),
      });
    }
    return { status: "processed" };
  }

  private async handleStart(chatId: string, token: string | undefined): Promise<void> {
    const customerId = token === undefined
      ? undefined
      : customerFromLinkToken(token, this.options.linkSecret);
    if (customerId === undefined) {
      await this.options.transport.sendMessage(chatId, "That Standby demo link is invalid or incomplete.");
      return;
    }
    const result = await this.options.store.transaction((state) => {
      const customer = state.customers.find((candidate) => candidate.id === customerId);
      if (customer === undefined) return { status: "missing" as const };
      const linkedElsewhere = state.customers.find(
        (candidate) => candidate.telegramChatId === chatId && candidate.id !== customer.id,
      );
      if (linkedElsewhere !== undefined) return { status: "conflict" as const };
      if (customer.telegramChatId !== undefined && customer.telegramChatId !== chatId) {
        return { status: "conflict" as const };
      }
      customer.telegramChatId = chatId;
      customer.updatedAt = this.clock();
      return { status: "linked" as const, name: customer.name };
    });
    if (result.status === "linked") {
      await this.options.transport.sendMessage(
        chatId,
        `You're linked as ${result.name}. Ask Standby to check availability, book, move, or cancel an appointment.`,
      );
      return;
    }
    await this.options.transport.sendMessage(
      chatId,
      result.status === "conflict"
        ? "That private link is already connected to another Telegram account."
        : "That demo customer could not be found.",
    );
  }
}
