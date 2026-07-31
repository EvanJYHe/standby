import { describe, expect, it } from "vitest";

import { StandbyEngine } from "../../domain/engine.js";
import { InMemoryStore } from "../../domain/store.js";
import { createDemoState } from "../seed.js";
import type { BackboardClient } from "./backboard.js";
import { SchedulingToolbox } from "./scheduling-tools.js";
import {
  createTelegramLinkToken,
  TelegramWebhookHandler,
  type TelegramTransport,
} from "./telegram.js";

const now = "2026-07-18T16:00:00.000Z";
const timezone = "America/Toronto";
const linkSecret = "test-link-secret-that-is-long-enough";

class CapturingTelegramTransport implements TelegramTransport {
  readonly sent: Array<{ chatId: string; text: string }> = [];

  async sendMessage(chatId: string, text: string): Promise<{ providerMessageId: string }> {
    this.sent.push({ chatId, text });
    return { providerMessageId: `message-${this.sent.length}` };
  }
}

describe("TelegramWebhookHandler", () => {
  it("links a private demo deep link to the intended seeded customer", async () => {
    const store = new InMemoryStore(createDemoState({ now, timezone }));
    const transport = new CapturingTelegramTransport();
    const backboard = { reply: async () => ({ content: "unused", threadId: "unused" }) } as unknown as BackboardClient;
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);
    const handler = new TelegramWebhookHandler({
      store,
      backboard,
      toolbox,
      transport,
      linkSecret,
      clock: () => now,
      idFactory: () => "processed-start",
    });

    const result = await handler.handle({
      update_id: 10,
      message: {
        message_id: 1,
        chat: { id: 1001 },
        text: `/start ${createTelegramLinkToken("josh", linkSecret)}`,
      },
    });

    expect(result).toEqual({ status: "processed" });
    expect((await store.read()).customers.find((customer) => customer.id === "josh")?.telegramChatId).toBe("1001");
    expect(transport.sent[0]).toMatchObject({ chatId: "1001", text: expect.stringContaining("Josh") });
  });

  it("deduplicates updates and persists one isolated Backboard thread per customer", async () => {
    const initial = createDemoState({
      now,
      timezone,
      contactOverrides: {
        josh: { telegramChatId: "1001" },
        alex: { telegramChatId: "2002" },
      },
    });
    const seededConversationIds = new Set(initial.conversations.map((conversation) => conversation.id));
    const store = new InMemoryStore(initial);
    const transport = new CapturingTelegramTransport();
    const calls: Array<{ customerId: string; threadId: string | undefined; content: string }> = [];
    const backboard = {
      reply: async (input: { actor: { customerId?: string }; threadId?: string; content: string }) => {
        const customerId = input.actor.customerId!;
        calls.push({ customerId, threadId: input.threadId, content: input.content });
        return { content: `Hello ${customerId}`, threadId: `thread-${customerId}` };
      },
    } as unknown as BackboardClient;
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);
    let id = 0;
    const handler = new TelegramWebhookHandler({
      store,
      backboard,
      toolbox,
      transport,
      linkSecret,
      clock: () => now,
      idFactory: () => `generated-${++id}`,
    });
    const joshUpdate = {
      update_id: 11,
      message: { message_id: 2, chat: { id: 1001 }, text: "When is my appointment?" },
    };

    await handler.handle(joshUpdate);
    const duplicate = await handler.handle(joshUpdate);
    await handler.handle({
      update_id: 12,
      message: { message_id: 3, chat: { id: 2002 }, text: "Do you have anything earlier?" },
    });

    expect(duplicate).toEqual({ status: "duplicate" });
    expect(calls).toEqual([
      { customerId: "josh", threadId: undefined, content: "When is my appointment?" },
      { customerId: "alex", threadId: undefined, content: "Do you have anything earlier?" },
    ]);
    expect((await store.read()).backboardThreads).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerId: "josh", threadId: "thread-josh" }),
      expect.objectContaining({ customerId: "alex", threadId: "thread-alex" }),
    ]));
    expect(transport.sent).toHaveLength(2);
    const snapshot = await store.read();
    const recordedConversations = snapshot.conversations.filter(
      (conversation) => !seededConversationIds.has(conversation.id),
    );
    expect(recordedConversations).toHaveLength(2);
    const joshConversation = recordedConversations.find(
      (conversation) => conversation.customerId === "josh" && conversation.providerConversationId === "1001",
    )!;
    expect(snapshot.conversationEvents
      .filter((event) => event.conversationId === joshConversation.id)
      .map((event) => ({ text: event.text, direction: event.direction, speaker: event.speaker })))
      .toEqual([
        { text: "When is my appointment?", direction: "inbound", speaker: "customer" },
        { text: "Hello josh", direction: "outbound", speaker: "agent" },
      ]);
  });

  it("adds active-offer context without trusting the customer's message for identity", async () => {
    const initial = createDemoState({
      now,
      timezone,
      contactOverrides: { alex: { telegramChatId: "2002" } },
    });
    initial.refillJobs.push({
      id: "job-1",
      sourceAppointmentId: "josh-appt",
      barberId: "jeremy",
      serviceId: "haircut",
      slotStartAt: "2026-07-20T21:00:00.000Z",
      slotEndAt: "2026-07-20T22:00:00.000Z",
      status: "awaiting_offer",
      moveDepth: 1,
      attemptedCustomerIds: ["alex"],
      currentOfferId: "offer-alex",
      timeline: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    initial.offers.push({
      id: "offer-alex",
      jobId: "job-1",
      customerId: "alex",
      candidateKind: "waitlist",
      channel: "telegram",
      status: "delivered",
      proposedStartAt: "2026-07-20T21:00:00.000Z",
      proposedEndAt: "2026-07-20T22:00:00.000Z",
      waitlistEntryId: "alex-waitlist",
      discountPercent: 0,
      expiresAt: "2026-07-20T16:05:00.000Z",
      deliveryAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    const store = new InMemoryStore(initial);
    const transport = new CapturingTelegramTransport();
    let content = "";
    const backboard = {
      reply: async (input: { content: string }) => {
        content = input.content;
        return { content: "Yes, that is the 5 PM opening.", threadId: "thread-alex" };
      },
    } as unknown as BackboardClient;
    const toolbox = new SchedulingToolbox(store, new StandbyEngine(store), () => now);
    const handler = new TelegramWebhookHandler({
      store,
      backboard,
      toolbox,
      transport,
      linkSecret,
      clock: () => now,
    });

    await handler.handle({
      update_id: 13,
      message: { message_id: 4, chat: { id: 2002 }, text: "Is that still with Jeremy?" },
    });

    expect(content).toContain("offer-alex");
    expect(content).toContain("Is that still with Jeremy?");
    expect(content).not.toContain("customer_id");
  });

  it("records a safe provider error instead of a successful-looking reply", async () => {
    const store = new InMemoryStore(createDemoState({
      now,
      timezone,
      contactOverrides: { alex: { telegramChatId: "2002" } },
    }));
    const transport = new CapturingTelegramTransport();
    const backboard = { reply: async () => { throw new Error("provider secret detail"); } } as unknown as BackboardClient;
    const handler = new TelegramWebhookHandler({
      store,
      backboard,
      toolbox: new SchedulingToolbox(store, new StandbyEngine(store), () => now),
      transport,
      linkSecret,
      clock: () => now,
    });

    await handler.handle({
      update_id: 14,
      message: { message_id: 5, chat: { id: 2002 }, text: "Can you move me?" },
    });

    const snapshot = await store.read();
    expect(snapshot.conversationEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "error",
        speaker: "system",
        deliveryState: "failed",
        text: "Standby could not reach the scheduling assistant. No appointment was changed.",
      }),
    ]));
    expect(JSON.stringify(snapshot.conversationEvents)).not.toContain("provider secret detail");
  });
});
