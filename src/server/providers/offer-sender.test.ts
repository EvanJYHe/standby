import { describe, expect, it } from "vitest";

import { InMemoryStore } from "../../domain/store.js";
import type { OfferDelivery } from "../../domain/worker.js";
import { createDemoState } from "../seed.js";
import type { BackboardClient } from "./backboard.js";
import type { ElevenLabsOutboundClient } from "./elevenlabs.js";
import { ProviderOfferSender } from "./offer-sender.js";
import type { TelegramTransport } from "./telegram.js";

const now = "2026-07-18T16:00:00.000Z";

function delivery(channel: "voice" | "telegram"): OfferDelivery {
  return {
    offer: {
      id: channel === "voice" ? "offer-sarah" : "offer-alex",
      jobId: "job-1",
      customerId: channel === "voice" ? "sarah" : "alex",
      candidateKind: channel === "voice" ? "move_earlier" : "waitlist",
      channel,
      status: "pending",
      proposedStartAt: "2026-07-20T21:00:00.000Z",
      proposedEndAt: "2026-07-20T22:00:00.000Z",
      ...(channel === "voice" ? {
        originalAppointmentId: "sarah-appt",
        originalStartAt: "2026-07-20T22:00:00.000Z",
      } : { waitlistEntryId: "alex-waitlist" }),
      discountPercent: 0,
      expiresAt: "2026-07-20T16:02:00.000Z",
      deliveryAttempts: 0,
      createdAt: now,
      updatedAt: now,
    },
    customer: {
      id: channel === "voice" ? "sarah" : "alex",
      name: channel === "voice" ? "Sarah" : "Alex",
      ...(channel === "voice" ? { phone: "+14165550101" } : { telegramChatId: "2002" }),
      contactPreference: channel,
      earlierMoveConsent: channel === "voice",
      flexibleBarberPreference: false,
      pastCustomerOptIn: channel === "voice",
    },
    barber: {
      id: "jeremy",
      name: "Jeremy",
      serviceIds: ["haircut"],
      weeklyHours: {},
    },
    service: {
      id: "haircut",
      name: "Signature haircut",
      durationMinutes: 60,
      priceCents: 4500,
    },
  };
}

describe("ProviderOfferSender", () => {
  it("uses Backboard wording and starts a signed outbound voice offer", async () => {
    const store = new InMemoryStore(createDemoState({
      now,
      timezone: "America/Toronto",
      preservedIdentities: { sarahPhone: "+14165550101" },
    }));
    const backboardCalls: string[] = [];
    const backboard = {
      reply: async (input: { content: string }) => {
        backboardCalls.push(input.content);
        return {
          content: "Hi Sarah — Jeremy had a 5 PM chair open up. Want it?",
          threadId: "thread-sarah",
        };
      },
    } as unknown as BackboardClient;
    let outboundInput: Record<string, unknown> | undefined;
    const elevenLabs = {
      call: async (input: Record<string, unknown>) => {
        outboundInput = input;
        return { providerMessageId: "conversation-1", callSid: "CA123" };
      },
    } as unknown as ElevenLabsOutboundClient;
    const telegram = { sendMessage: async () => ({ providerMessageId: "unused" }) };
    const sender = new ProviderOfferSender({
      store,
      backboard,
      telegram,
      elevenLabs,
      voiceTokenSecret: "voice-token-secret-that-is-long-enough",
      clock: () => now,
    });

    const result = await sender.send(delivery("voice"));

    expect(result).toEqual({ providerMessageId: "conversation-1" });
    expect(backboardCalls[0]).toContain("Sarah");
    expect(backboardCalls[0]).toContain("Jeremy");
    expect(outboundInput).toMatchObject({
      toNumber: "+14165550101",
      dynamicVariables: {
        offer_id: "offer-sarah",
        customer_id: "sarah",
        customer_name: "Sarah",
        offer_message: "Hi Sarah — Jeremy had a 5 PM chair open up. Want it?",
        appointment_summary: expect.stringContaining("current appointment"),
        secret__actor_token: expect.any(String),
      },
    });
    expect((await store.read()).backboardThreads).toContainEqual(expect.objectContaining({
      customerId: "sarah",
      threadId: "thread-sarah",
    }));
    expect((await store.read()).conversationEvents).toContainEqual(expect.objectContaining({
      kind: "delivery",
      direction: "outbound",
      speaker: "agent",
      text: "Hi Sarah — Jeremy had a 5 PM chair open up. Want it?",
      offerId: "offer-sarah",
      deliveryState: "delivered",
    }));
  });

  it("sends the Backboard-authored offer to the linked Telegram account", async () => {
    const store = new InMemoryStore(createDemoState({
      now,
      timezone: "America/Toronto",
      preservedIdentities: { alexTelegramChatId: "2002" },
    }));
    const backboard = {
      reply: async () => ({ content: "Alex, 6 PM with Jeremy is yours if you want it.", threadId: "thread-alex" }),
    } as unknown as BackboardClient;
    const sent: Array<{ chatId: string; text: string }> = [];
    const telegram: TelegramTransport = {
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
        return { providerMessageId: "telegram-1" };
      },
    };
    const sender = new ProviderOfferSender({
      store,
      backboard,
      telegram,
      voiceTokenSecret: "voice-token-secret-that-is-long-enough",
      clock: () => now,
    });

    const result = await sender.send(delivery("telegram"));

    expect(result).toEqual({ providerMessageId: "telegram-1" });
    expect(sent).toEqual([{ chatId: "2002", text: "Alex, 6 PM with Jeremy is yours if you want it." }]);
    expect((await store.read()).conversationEvents).toContainEqual(expect.objectContaining({
      kind: "message",
      direction: "outbound",
      speaker: "agent",
      text: "Alex, 6 PM with Jeremy is yours if you want it.",
      offerId: "offer-alex",
      deliveryState: "delivered",
    }));
  });
});
