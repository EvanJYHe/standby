import { createHmac, timingSafeEqual } from "node:crypto";

import { DateTime } from "luxon";
import { z } from "zod";

export interface VoiceActorPayload {
  customerId?: string;
  callId: string;
  offerId?: string;
  expiresAt: string;
}

function actorSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`voice-actor:${payload}`).digest("base64url");
}

export function createVoiceActorToken(payload: VoiceActorPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${actorSignature(encoded, secret)}`;
}

export function verifyVoiceActorToken(token: string, secret: string, now: string): VoiceActorPayload {
  const [payload, signature, extra] = token.split(".");
  if (payload === undefined || signature === undefined || extra !== undefined) {
    throw new Error("Invalid voice actor token.");
  }
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(actorSignature(payload, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid voice actor token.");
  }
  try {
    const parsed = z.object({
      customerId: z.string().optional(),
      callId: z.string(),
      offerId: z.string().optional(),
      expiresAt: z.string().refine((value) => DateTime.fromISO(value).isValid),
    }).strict().parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (DateTime.fromISO(parsed.expiresAt).toMillis() <= DateTime.fromISO(now).toMillis()) {
      throw new Error("expired");
    }
    return {
      ...(parsed.customerId === undefined ? {} : { customerId: parsed.customerId }),
      callId: parsed.callId,
      ...(parsed.offerId === undefined ? {} : { offerId: parsed.offerId }),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    throw new Error("Invalid voice actor token.");
  }
}
