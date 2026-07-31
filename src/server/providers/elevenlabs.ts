import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { DateTime } from "luxon";
import { z } from "zod";

import type { StandbyEngine } from "../../domain/engine.js";
import type { StandbyStore } from "../../domain/store.js";
import type { SchedulingToolbox } from "./scheduling-tools.js";
import { recordConversationEvent } from "../conversations.js";

interface VoiceActorPayload {
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
      expiresAt: z.string(),
    }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
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

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

const inboundContextSchema = z.object({
  caller_id: z.string(),
  agent_id: z.string(),
  called_number: z.string(),
  call_sid: z.string(),
}).strict();

const postCallSchema = z.object({
  type: z.enum(["post_call_transcription", "call_initiation_failure"]),
  event_timestamp: z.number(),
  data: z.object({
    agent_id: z.string(),
    conversation_id: z.string(),
    status: z.string().optional(),
    failure_reason: z.string().optional(),
    metadata: z.unknown().optional(),
    transcript: z.array(z.object({
      role: z.enum(["agent", "user"]),
      message: z.string(),
      time_in_call_secs: z.number().nonnegative().optional(),
    }).passthrough()).optional(),
    conversation_initiation_client_data: z.object({
      dynamic_variables: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

const AVAILABILITY_FIRST_GREETING =
  "I can help you find and book an appointment. What day and time are you available?";

interface ElevenLabsWebhookServiceOptions {
  store: StandbyStore;
  engine: StandbyEngine;
  toolbox: SchedulingToolbox;
  agentId: string;
  webhookSecret: string;
  clock?: () => string;
}

export class ElevenLabsWebhookService {
  private readonly clock: () => string;

  constructor(private readonly options: ElevenLabsWebhookServiceOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async inboundContext(payload: unknown) {
    const input = inboundContextSchema.parse(payload);
    if (input.agent_id !== this.options.agentId) throw new Error("Unexpected ElevenLabs agent.");
    const state = await this.options.store.read();
    const customer = state.customers.find(
      (candidate) => candidate.phone !== undefined
        && normalizePhone(candidate.phone) === normalizePhone(input.caller_id),
    );
    if (customer === undefined) {
      const token = createVoiceActorToken({
        callId: input.call_sid,
        expiresAt: DateTime.fromISO(this.clock()).plus({ hours: 4 }).toUTC().toISO()!,
      }, this.options.webhookSecret);
      return {
        type: "conversation_initiation_client_data" as const,
        dynamic_variables: {
          customer_id: "",
          customer_name: "Guest",
          timezone: state.settings.timezone,
          secret__actor_token: token,
          offer_id: "",
          offer_message: AVAILABILITY_FIRST_GREETING,
          barber_name: "",
          service_name: "",
          old_time: "",
          proposed_time: "",
          discount_percent: 0,
          appointment_summary: "No linked customer record was found for this caller.",
        },
      };
    }
    const activeOffer = state.offers.find(
      (offer) => offer.customerId === customer.id && ["pending", "delivered"].includes(offer.status),
    );
    const appointments = state.appointments
      .filter((appointment) => appointment.customerId === customer.id && appointment.status === "confirmed")
      .map((appointment) => {
        const barber = state.barbers.find((candidate) => candidate.id === appointment.barberId)?.name ?? "a barber";
        const service = state.services.find((candidate) => candidate.id === appointment.serviceId)?.name ?? "service";
        const time = DateTime.fromISO(appointment.startAt)
          .setZone(state.settings.timezone)
          .toFormat("cccc, LLLL d 'at' h:mm a");
        return `${service} with ${barber} on ${time}`;
      });
    const token = createVoiceActorToken({
      customerId: customer.id,
      callId: input.call_sid,
      ...(activeOffer === undefined ? {} : { offerId: activeOffer.id }),
      expiresAt: DateTime.fromISO(this.clock()).plus({ hours: 4 }).toUTC().toISO()!,
    }, this.options.webhookSecret);
    return {
      type: "conversation_initiation_client_data" as const,
      dynamic_variables: {
        customer_id: customer.id,
        customer_name: customer.name,
        timezone: state.settings.timezone,
        secret__actor_token: token,
        offer_id: activeOffer?.id ?? "",
        offer_message: AVAILABILITY_FIRST_GREETING,
        barber_name: "",
        service_name: "",
        old_time: "",
        proposed_time: "",
        discount_percent: 0,
        appointment_summary: appointments.join("; ") || "No confirmed appointments.",
      },
    };
  }

  async executeTool(name: string, input: unknown, authorization: string | undefined): Promise<unknown> {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : authorization;
    if (token === undefined || token === "") {
      return { type: "error", code: "UNAUTHORIZED", message: "The voice request was not authenticated." };
    }
    let actor: VoiceActorPayload;
    try {
      actor = verifyVoiceActorToken(
        token,
        this.options.webhookSecret,
        this.clock(),
      );
    } catch {
      return { type: "error", code: "UNAUTHORIZED", message: "The voice request was not authenticated." };
    }
    let safeInput = input;
    if (name === "respond_to_offer" && actor.offerId !== undefined) {
      const inputRecord = typeof input === "object" && input !== null
        ? input as Record<string, unknown>
        : {};
      safeInput = { ...inputRecord, offer_id: actor.offerId };
    }
    return this.options.toolbox.execute(name, safeInput, {
      provider: "elevenlabs",
      ...(actor.customerId === undefined ? {} : { customerId: actor.customerId }),
      requestId: actor.callId,
    });
  }

  async handlePostCall(rawBody: string, signatureHeader: string | undefined): Promise<{ status: "processed" | "duplicate" }> {
    const event = this.verifyPostCall(rawBody, signatureHeader);
    if (event.data.agent_id !== this.options.agentId) throw new Error("Unexpected ElevenLabs agent.");
    const eventId = `${event.type}:${event.data.conversation_id}`;
    const duplicate = await this.options.store.transaction((state) => {
      if (state.processedEvents.some(
        (processed) => processed.provider === "elevenlabs" && processed.eventId === eventId,
      )) return true;
      state.processedEvents.push({
        id: randomUUID(),
        provider: "elevenlabs",
        eventId,
        processedAt: this.clock(),
      });
      return false;
    });
    if (duplicate) return { status: "duplicate" };

    const state = await this.options.store.read();
    const dynamicOfferId = event.data.conversation_initiation_client_data?.dynamic_variables?.offer_id;
    const dynamicCustomerId = event.data.conversation_initiation_client_data?.dynamic_variables?.customer_id;
    const offer = state.offers.find((candidate) => (
      candidate.id === dynamicOfferId || candidate.providerMessageId === event.data.conversation_id
    ));
    const customerId = typeof dynamicCustomerId === "string" && dynamicCustomerId !== ""
      ? dynamicCustomerId
      : offer?.customerId;
    const conversationDirection = offer === undefined ? "inbound" as const : "outbound" as const;

    if (customerId !== undefined && event.type === "post_call_transcription") {
      const turns = event.data.transcript ?? [];
      for (const [index, turn] of turns.entries()) {
        const occurredAt = DateTime.fromSeconds(event.event_timestamp)
          .plus({ milliseconds: index })
          .toUTC()
          .toISO()!;
        await recordConversationEvent(this.options.store, {
          customerId,
          channel: "voice",
          conversationDirection,
          providerConversationId: event.data.conversation_id,
          providerEventId: `${eventId}:turn:${index}`,
          kind: "transcript",
          direction: turn.role === "agent" ? "outbound" : "inbound",
          speaker: turn.role === "agent" ? "agent" : "customer",
          text: turn.message,
          conversationState: index === turns.length - 1 ? "completed" : "active",
          ...(turn.time_in_call_secs === undefined ? {} : {
            metadata: { timeInCallSeconds: turn.time_in_call_secs },
          }),
          ...(offer === undefined ? {} : {
            offerId: offer.id,
            refillJobId: offer.jobId,
          }),
          occurredAt,
        });
      }
      if (turns.length === 0) {
        await recordConversationEvent(this.options.store, {
          customerId,
          channel: "voice",
          conversationDirection,
          providerConversationId: event.data.conversation_id,
          providerEventId: `${eventId}:completed`,
          kind: "delivery",
          speaker: "system",
          text: "Voice call completed.",
          conversationState: "completed",
          ...(offer === undefined ? {} : {
            offerId: offer.id,
            refillJobId: offer.jobId,
          }),
          occurredAt: DateTime.fromSeconds(event.event_timestamp).toUTC().toISO()!,
        });
      }
    }
    if (customerId !== undefined && event.type === "call_initiation_failure") {
      const safeReason = (event.data.failure_reason ?? "unknown").replaceAll("-", " ");
      await recordConversationEvent(this.options.store, {
        customerId,
        channel: "voice",
        conversationDirection,
        providerConversationId: event.data.conversation_id,
        providerEventId: `${eventId}:failure`,
        kind: "error",
        speaker: "system",
        text: `Outbound call failed: ${safeReason}.`,
        deliveryState: "failed",
        conversationState: "failed",
        ...(offer === undefined ? {} : {
          offerId: offer.id,
          refillJobId: offer.jobId,
        }),
        occurredAt: DateTime.fromSeconds(event.event_timestamp).toUTC().toISO()!,
      });
    }
    if (offer !== undefined && ["pending", "delivered"].includes(offer.status)) {
      await this.options.engine.respondToOffer({
        actor: { provider: "elevenlabs", customerId: offer.customerId, providerEventId: eventId },
        offerId: offer.id,
        response: "decline",
        confirmed: true,
        now: this.clock(),
      });
    }
    return { status: "processed" };
  }

  private verifyPostCall(rawBody: string, signatureHeader: string | undefined) {
    if (signatureHeader === undefined) throw new Error("Invalid ElevenLabs signature.");
    const parts = signatureHeader.split(",");
    const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
    const signature = parts.find((part) => part.startsWith("v0="))?.slice(3);
    if (timestamp === undefined || signature === undefined) {
      throw new Error("Invalid ElevenLabs signature.");
    }
    const timestampMillis = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMillis) || Date.now() - timestampMillis > 30 * 60 * 1000) {
      throw new Error("Invalid ElevenLabs signature.");
    }
    const expectedHex = createHmac("sha256", this.options.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const supplied = Buffer.from(signature);
    const expected = Buffer.from(expectedHex);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("Invalid ElevenLabs signature.");
    }
    try {
      return postCallSchema.parse(JSON.parse(rawBody));
    } catch {
      throw new Error("Invalid ElevenLabs webhook payload.");
    }
  }
}

interface ElevenLabsOutboundClientOptions {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}

interface OutboundCallInput {
  toNumber: string;
  dynamicVariables: Record<string, string | number | boolean>;
}

export class ElevenLabsOutboundClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ElevenLabsOutboundClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(input: OutboundCallInput): Promise<{ providerMessageId: string; callSid: string | null }> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
        method: "POST",
        headers: {
          "xi-api-key": this.options.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: this.options.agentId,
          agent_phone_number_id: this.options.phoneNumberId,
          to_number: normalizePhone(input.toNumber),
          conversation_initiation_client_data: {
            dynamic_variables: input.dynamicVariables,
          },
          call_recording_enabled: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("ElevenLabs call initiation failed.");
    }
    if (!response.ok) throw new Error("ElevenLabs call initiation failed.");
    const parsed = z.object({
      success: z.boolean(),
      conversation_id: z.string().nullable(),
      callSid: z.string().nullable(),
    }).passthrough().safeParse(await response.json().catch(() => ({})));
    if (!parsed.success || !parsed.data.success || parsed.data.conversation_id === null) {
      throw new Error("ElevenLabs call initiation failed.");
    }
    return {
      providerMessageId: parsed.data.conversation_id,
      callSid: parsed.data.callSid,
    };
  }
}
