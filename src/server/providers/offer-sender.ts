import { randomUUID } from "node:crypto";

import { DateTime } from "luxon";

import type { StandbyStore } from "../../domain/store.js";
import type { ContactPreference, Customer } from "../../domain/types.js";
import type { OfferDelivery, OfferSender } from "../../domain/worker.js";
import { recordConversationEvent } from "../conversations.js";
import type { BackboardClient } from "./backboard.js";
import type { TelegramTransport } from "./telegram.js";
import {
  e164PhoneSchema,
  type VoiceCallProvider,
  voiceConversationKey,
} from "./voice-agent.js";
import { createVoiceActorToken } from "./voice-session.js";

interface ProviderOfferSenderOptions {
  store: StandbyStore;
  backboard?: BackboardClient;
  telegram?: TelegramTransport;
  voice?: VoiceCallProvider;
  voiceTokenSecret?: string;
  clock?: () => string;
}

export class ProviderOfferSender implements OfferSender {
  private readonly clock: () => string;

  constructor(private readonly options: ProviderOfferSenderOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  canReach(customer: Customer, channel: ContactPreference): boolean {
    if (channel === "telegram") {
      return this.options.telegram !== undefined && customer.telegramChatId !== undefined;
    }
    return this.options.voice !== undefined
      && this.options.voiceTokenSecret !== undefined
      && customer.phone !== undefined
      && e164PhoneSchema.safeParse(customer.phone).success;
  }

  async send(delivery: OfferDelivery): Promise<{ providerMessageId: string }> {
    const state = await this.options.store.read();
    const thread = state.backboardThreads.find(
      (candidate) => candidate.customerId === delivery.customer.id,
    );
    const proposed = DateTime.fromISO(delivery.offer.proposedStartAt)
      .setZone(state.settings.timezone)
      .toFormat("cccc, LLLL d 'at' h:mm a");
    const original = delivery.offer.originalStartAt === undefined
      ? "no existing appointment"
      : DateTime.fromISO(delivery.offer.originalStartAt)
          .setZone(state.settings.timezone)
          .toFormat("cccc, LLLL d 'at' h:mm a");
    const discount = delivery.offer.discountPercent > 0
      ? ` Include the ${delivery.offer.discountPercent}% opening discount.`
      : "";
    const composed = this.options.backboard === undefined
      ? {
          content: `${delivery.customer.name}, ${delivery.service.name} with ${delivery.barber.name} opened up ${proposed}. Would you like it?`,
        }
      : await this.options.backboard.reply({
          content: [
            "Write one short outbound Standby appointment offer; do not call tools.",
            `Customer: ${delivery.customer.name}.`,
            `Barber: ${delivery.barber.name}. Service: ${delivery.service.name}.`,
            `Proposed time: ${proposed}. Current time: ${original}.`,
            `${discount} Ask one clear yes-or-no question and mention the offer expires shortly.`,
            `Private offer reference (never show it): ${delivery.offer.id}.`,
          ].join("\n"),
          ...(thread === undefined ? {} : { threadId: thread.threadId }),
          actor: { provider: "worker", customerId: delivery.customer.id, requestId: delivery.offer.id },
          tools: [],
          executeTool: async () => ({ type: "error", code: "TOOLS_DISABLED" }),
        });
    if ("threadId" in composed) await this.persistThread(delivery.customer.id, composed.threadId);

    if (delivery.offer.channel === "telegram") {
      if (delivery.customer.telegramChatId === undefined || this.options.telegram === undefined) {
        throw new Error("The Telegram customer has not linked an account.");
      }
      const sent = await this.options.telegram.sendMessage(delivery.customer.telegramChatId, composed.content);
      await recordConversationEvent(this.options.store, {
        customerId: delivery.customer.id,
        channel: "telegram",
        conversationDirection: "outbound",
        providerConversationId: delivery.customer.telegramChatId,
        providerEventId: `telegram:message:${sent.providerMessageId}`,
        kind: "message",
        direction: "outbound",
        speaker: "agent",
        text: composed.content,
        deliveryState: "delivered",
        offerId: delivery.offer.id,
        refillJobId: delivery.offer.jobId,
        occurredAt: this.clock(),
      });
      return sent;
    }
    if (
      delivery.customer.phone === undefined
      || this.options.voice === undefined
      || this.options.voiceTokenSecret === undefined
    ) {
      throw new Error("The voice provider or customer phone is not configured.");
    }
    const actorToken = createVoiceActorToken({
      customerId: delivery.customer.id,
      callId: `outbound:${delivery.offer.id}`,
      offerId: delivery.offer.id,
      expiresAt: delivery.offer.expiresAt,
    }, this.options.voiceTokenSecret);
    const call = await this.options.voice.startCall({
      idempotencyKey: delivery.offer.id,
      to: delivery.customer.phone,
      context: {
        customer: { id: delivery.customer.id, name: delivery.customer.name },
        offer: {
          id: delivery.offer.id,
          message: composed.content,
          expiresAt: delivery.offer.expiresAt,
          discountPercent: delivery.offer.discountPercent,
        },
        appointment: {
          barberName: delivery.barber.name,
          serviceName: delivery.service.name,
          currentTime: delivery.offer.originalStartAt === undefined ? null : original,
          proposedTime: proposed,
          summary: delivery.offer.originalStartAt === undefined
            ? "No existing appointment is being moved."
            : `Your current appointment is ${original}.`,
        },
        actorToken,
        timezone: state.settings.timezone,
      },
    });
    await recordConversationEvent(this.options.store, {
      customerId: delivery.customer.id,
      channel: "voice",
      conversationDirection: "outbound",
      providerConversationId: voiceConversationKey(call.provider, call.conversationId),
      providerEventId: `${call.provider}:call:${call.conversationId}`,
      kind: "delivery",
      direction: "outbound",
      speaker: "agent",
      text: composed.content,
      deliveryState: "delivered",
      offerId: delivery.offer.id,
      refillJobId: delivery.offer.jobId,
      occurredAt: this.clock(),
    });
    return { providerMessageId: call.conversationId };
  }

  private async persistThread(customerId: string, threadId: string): Promise<void> {
    await this.options.store.transaction((state) => {
      const mapping = state.backboardThreads.find((candidate) => candidate.customerId === customerId);
      if (mapping === undefined) {
        state.backboardThreads.push({
          id: randomUUID(),
          customerId,
          threadId,
          createdAt: this.clock(),
          updatedAt: this.clock(),
        });
      } else {
        mapping.threadId = threadId;
        mapping.updatedAt = this.clock();
      }
    });
  }
}
