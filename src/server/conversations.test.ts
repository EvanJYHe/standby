import { describe, expect, it } from "vitest";

import { InMemoryStore } from "../domain/store.js";
import { recordConversationEvent } from "./conversations.js";
import { createDemoState } from "./seed.js";

const now = "2026-07-20T16:00:00.000Z";
const later = "2026-07-20T16:00:03.000Z";

function store() {
  return new InMemoryStore(createDemoState({
    now,
    timezone: "America/Toronto",
    preservedIdentities: { alexTelegramChatId: "2002" },
  }));
}

describe("recordConversationEvent", () => {
  it("upserts one conversation and stores its real turns in chronological order", async () => {
    const standbyStore = store();

    const first = await recordConversationEvent(standbyStore, {
      customerId: "alex",
      channel: "telegram",
      conversationDirection: "inbound",
      providerConversationId: "chat-2002",
      providerEventId: "update-1",
      kind: "message",
      direction: "inbound",
      speaker: "customer",
      text: "Is the 6 PM opening still available?",
      occurredAt: now,
    });
    const second = await recordConversationEvent(standbyStore, {
      customerId: "alex",
      channel: "telegram",
      conversationDirection: "inbound",
      providerConversationId: "chat-2002",
      providerEventId: "message-9",
      kind: "message",
      direction: "outbound",
      speaker: "agent",
      text: "Yes — would you like me to reserve it?",
      deliveryState: "delivered",
      occurredAt: later,
    });

    const snapshot = await standbyStore.read();
    expect(first).toEqual({ status: "recorded", conversationId: second.conversationId });
    expect(snapshot.conversations).toEqual([
      expect.objectContaining({
        id: second.conversationId,
        customerId: "alex",
        channel: "telegram",
        direction: "inbound",
        providerConversationId: "chat-2002",
        state: "active",
        preview: "Yes — would you like me to reserve it?",
        createdAt: now,
        updatedAt: later,
      }),
    ]);
    expect(snapshot.conversationEvents.map((event) => ({
      text: event.text,
      direction: event.direction,
      speaker: event.speaker,
      deliveryState: event.deliveryState,
    }))).toEqual([
      {
        text: "Is the 6 PM opening still available?",
        direction: "inbound",
        speaker: "customer",
        deliveryState: undefined,
      },
      {
        text: "Yes — would you like me to reserve it?",
        direction: "outbound",
        speaker: "agent",
        deliveryState: "delivered",
      },
    ]);
  });

  it("deduplicates provider events within a conversation", async () => {
    const standbyStore = store();
    const input = {
      customerId: "alex",
      channel: "telegram" as const,
      conversationDirection: "inbound" as const,
      providerConversationId: "chat-2002",
      providerEventId: "update-1",
      kind: "message" as const,
      direction: "inbound" as const,
      speaker: "customer" as const,
      text: "Hello",
      occurredAt: now,
    };

    await recordConversationEvent(standbyStore, input);
    const duplicate = await recordConversationEvent(standbyStore, input);

    expect(duplicate.status).toBe("duplicate");
    expect((await standbyStore.read()).conversationEvents).toHaveLength(1);
  });

  it("stores only normalized scalar metadata and trims safe text", async () => {
    const standbyStore = store();

    await recordConversationEvent(standbyStore, {
      customerId: "alex",
      channel: "voice",
      conversationDirection: "outbound",
      providerConversationId: "conversation-1",
      providerEventId: "turn-1",
      kind: "transcript",
      direction: "inbound",
      speaker: "customer",
      text: "  Yes, please move me.  ",
      metadata: { timeInCallSeconds: 4 },
      conversationState: "completed",
      offerId: "offer-1",
      occurredAt: later,
    });

    const snapshot = await standbyStore.read();
    expect(snapshot.conversations[0]).toMatchObject({
      channel: "voice",
      direction: "outbound",
      state: "completed",
      offerId: "offer-1",
    });
    expect(snapshot.conversationEvents[0]).toMatchObject({
      text: "Yes, please move me.",
      metadata: { timeInCallSeconds: 4 },
      offerId: "offer-1",
    });
  });
});
