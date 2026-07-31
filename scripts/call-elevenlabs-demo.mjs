import { createHmac, randomUUID } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const required = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_AGENT_ID",
  "ELEVENLABS_PHONE_NUMBER_ID",
  "ELEVENLABS_WEBHOOK_SECRET",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const destination = process.env.DESTINATION_PHONE ?? process.env.SARAH_PHONE;
if (!destination) throw new Error("DESTINATION_PHONE or SARAH_PHONE is required.");

const customerId = process.env.DEMO_CUSTOMER_ID ?? "sarah";
const customerName = process.env.DEMO_CUSTOMER_NAME ?? "Sarah";
const recordingEnabled = process.env.CALL_RECORDING_ENABLED === "true";
const callId = `outbound:availability-demo:${randomUUID()}`;
const payload = Buffer.from(JSON.stringify({
  customerId,
  callId,
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
})).toString("base64url");
const signature = createHmac("sha256", process.env.ELEVENLABS_WEBHOOK_SECRET)
  .update(`voice-actor:${payload}`)
  .digest("base64url");
const actorToken = `${payload}.${signature}`;

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const result = await client.conversationalAi.twilio.outboundCall({
  agentId: process.env.ELEVENLABS_AGENT_ID,
  agentPhoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID,
  toNumber: destination,
  callRecordingEnabled: recordingEnabled,
  conversationInitiationClientData: {
    dynamicVariables: {
      offer_id: "",
      customer_id: customerId,
      customer_name: customerName,
      barber_name: "",
      service_name: "",
      old_time: "",
      proposed_time: "",
      discount_percent: 0,
      offer_message: `Hi ${customerName}, I can help you find and book an appointment. What day and time are you available?`,
      appointment_summary: "Ask the caller before looking up or creating a new appointment.",
      secret__actor_token: actorToken,
      timezone: "America/Toronto",
    },
  },
});

if (!result.success || !result.conversationId) {
  throw new Error(result.message || "ElevenLabs did not initiate the call.");
}

console.log(JSON.stringify({
  status: "initiated",
  conversationId: result.conversationId,
  callSid: result.callSid ?? null,
  recordingEnabled,
}));
