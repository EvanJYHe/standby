import { createHash, randomUUID } from "node:crypto";

import type { StandbyStore } from "../domain/store.js";
import type {
  ConversationDirection,
  ConversationEventKind,
  ConversationChannel,
  ConversationState,
} from "../domain/types.js";

export interface RecordConversationEventInput {
  customerId: string;
  channel: ConversationChannel;
  conversationDirection: ConversationDirection;
  providerConversationId: string;
  providerEventId?: string;
  kind: ConversationEventKind;
  direction?: ConversationDirection;
  speaker: "customer" | "agent" | "system";
  text: string;
  deliveryState?: "pending" | "delivered" | "failed";
  conversationState?: ConversationState;
  appointmentId?: string;
  refillJobId?: string;
  offerId?: string;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export type RecordConversationEventResult = {
  status: "recorded" | "duplicate";
  conversationId: string;
};

function conversationId(channel: ConversationChannel, providerConversationId: string): string {
  const digest = createHash("sha256")
    .update(`${channel}:${providerConversationId}`)
    .digest("hex")
    .slice(0, 24);
  return `conversation-${digest}`;
}

export async function recordConversationEvent(
  store: StandbyStore,
  input: RecordConversationEventInput,
): Promise<RecordConversationEventResult> {
  const text = input.text.trim();
  if (text === "") throw new Error("Conversation event text cannot be empty.");
  const id = conversationId(input.channel, input.providerConversationId);

  return store.transaction((state) => {
    let conversation = state.conversations.find((candidate) => candidate.id === id);
    if (conversation === undefined) {
      conversation = {
        id,
        customerId: input.customerId,
        channel: input.channel,
        direction: input.conversationDirection,
        providerConversationId: input.providerConversationId,
        state: input.conversationState ?? "active",
        preview: text,
        ...(input.offerId === undefined ? {} : { offerId: input.offerId }),
        ...(input.appointmentId === undefined ? {} : { appointmentId: input.appointmentId }),
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };
      state.conversations.push(conversation);
    }

    if (
      input.providerEventId !== undefined
      && state.conversationEvents.some((event) => (
        event.conversationId === id && event.providerEventId === input.providerEventId
      ))
    ) {
      return { status: "duplicate", conversationId: id };
    }

    if (input.occurredAt >= conversation.updatedAt) {
      conversation.preview = text;
      conversation.updatedAt = input.occurredAt;
    }
    if (input.conversationState !== undefined) conversation.state = input.conversationState;
    if (input.offerId !== undefined) conversation.offerId = input.offerId;
    if (input.appointmentId !== undefined) conversation.appointmentId = input.appointmentId;

    state.conversationEvents.push({
      id: randomUUID(),
      conversationId: id,
      kind: input.kind,
      ...(input.direction === undefined ? {} : { direction: input.direction }),
      speaker: input.speaker,
      text,
      ...(input.deliveryState === undefined ? {} : { deliveryState: input.deliveryState }),
      ...(input.providerEventId === undefined ? {} : { providerEventId: input.providerEventId }),
      ...(input.appointmentId === undefined ? {} : { appointmentId: input.appointmentId }),
      ...(input.refillJobId === undefined ? {} : { refillJobId: input.refillJobId }),
      ...(input.offerId === undefined ? {} : { offerId: input.offerId }),
      occurredAt: input.occurredAt,
      ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
    });
    state.conversationEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

    return { status: "recorded", conversationId: id };
  });
}
