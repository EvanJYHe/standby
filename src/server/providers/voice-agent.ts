import { z } from "zod";

export const e164PhoneSchema = z.string().regex(
  /^\+[1-9]\d{7,14}$/,
  "Expected an E.164 phone number such as +14165550101.",
);

export interface VoiceCallContext {
  customer: {
    id: string;
    name: string;
  };
  offer: {
    id: string;
    message: string;
    expiresAt: string;
    discountPercent: number;
  };
  appointment: {
    barberName: string;
    serviceName: string;
    currentTime: string | null;
    proposedTime: string;
    summary: string;
  };
  timezone: string;
  actorToken: string;
}

export interface VoiceCallRequest {
  idempotencyKey: string;
  to: string;
  context: VoiceCallContext;
}

export interface VoiceCallReceipt {
  provider: string;
  conversationId: string;
  providerCallId?: string;
}

/**
 * Provider-neutral boundary used by the scheduling workflow. Provider-specific
 * payloads, authentication, and response parsing stay behind this interface.
 */
export interface VoiceCallProvider {
  readonly provider: string;
  startCall(request: VoiceCallRequest): Promise<VoiceCallReceipt>;
}

export function voiceConversationKey(provider: string, conversationId: string): string {
  return `${provider}:${conversationId}`;
}
