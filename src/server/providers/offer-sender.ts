import { randomUUID } from "node:crypto";

import { DateTime } from "luxon";

import type { StandbyStore } from "../../domain/store.js";
import type { OfferDelivery, OfferSender } from "../../domain/worker.js";
import { recordConversationEvent } from "../conversations.js";
import type { BackboardClient } from "./backboard.js";
import { createVoiceActorToken, type ElevenLabsOutboundClient } from "./elevenlabs.js";
import type { TelegramTransport } from "./telegram.js";

interface ProviderOfferSenderOptions {
  store: StandbyStore;
  backboard: BackboardClient;
  telegram: TelegramTransport;
  elevenLabs?: ElevenLabsOutboundClient;
  voiceTokenSecret: string;
  clock?: () => string;
}

export class ProviderOfferSender implements OfferSender {
  private readonly clock: () => string;

  constructor(private readonly options: ProviderOfferSenderOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
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
    const composed = await this.options.backboard.reply({
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
    await this.persistThread(delivery.customer.id, composed.threadId);

    if (delivery.offer.channel === "telegram") {
      if (delivery.customer.telegramChatId === undefined) {
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
    if (delivery.customer.phone === undefined || this.options.elevenLabs === undefined) {
      throw new Error("The voice provider or customer phone is not configured.");
    }
    const actorToken = createVoiceActorToken({
      customerId: delivery.customer.id,
      callId: `outbound:${delivery.offer.id}`,
      offerId: delivery.offer.id,
      expiresAt: delivery.offer.expiresAt,
    }, this.options.voiceTokenSecret);
    const call = await this.options.elevenLabs.call({
      toNumber: delivery.customer.phone,
      dynamicVariables: {
        offer_id: delivery.offer.id,
        customer_id: delivery.customer.id,
        customer_name: delivery.customer.name,
        barber_name: delivery.barber.name,
        service_name: delivery.service.name,
        old_time: original,
        proposed_time: proposed,
        discount_percent: delivery.offer.discountPercent,
        offer_message: composed.content,
        appointment_summary: delivery.offer.originalStartAt === undefined
          ? "No existing appointment is being moved."
          : `Your current appointment is ${original}.`,
        secret__actor_token: actorToken,
        timezone: state.settings.timezone,
      },
    });
    await recordConversationEvent(this.options.store, {
      customerId: delivery.customer.id,
      channel: "voice",
      conversationDirection: "outbound",
      providerConversationId: call.providerMessageId,
      providerEventId: `elevenlabs:call:${call.providerMessageId}`,
      kind: "delivery",
      direction: "outbound",
      speaker: "agent",
      text: composed.content,
      deliveryState: "delivered",
      offerId: delivery.offer.id,
      refillJobId: delivery.offer.jobId,
      occurredAt: this.clock(),
    });
    return { providerMessageId: call.providerMessageId };
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
