import { createHmac, randomUUID } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const requiredDemoInput = ["DESTINATION_PHONE", "DEMO_CUSTOMER_ID", "DEMO_CUSTOMER_NAME"];
for (const name of requiredDemoInput) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required.`);
}

const destination = process.env.DESTINATION_PHONE.trim();
if (!/^\+[1-9]\d{7,14}$/.test(destination)) {
  throw new Error("DESTINATION_PHONE must be an E.164 phone number.");
}

const customerId = process.env.DEMO_CUSTOMER_ID.trim();
const customerName = process.env.DEMO_CUSTOMER_NAME.trim();
const recordingEnabled = process.env.CALL_RECORDING_ENABLED === "true";
const executeVoiceCall = process.env.EXECUTE_VOICE_CALL === "true";
const callId = `outbound:availability-demo:${randomUUID()}`;
const timezone = process.env.SHOP_TIMEZONE?.trim() || "America/Toronto";
const dynamicVariables = {
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
  timezone,
};

function redactPhone(phone) {
  return `${phone.slice(0, 2)}${"\u2022".repeat(Math.max(0, phone.length - 6))}${phone.slice(-4)}`;
}

if (!executeVoiceCall) {
  console.log(JSON.stringify({
    status: "dry_run",
    message: "No call was placed. Set EXECUTE_VOICE_CALL=true to execute this plan.",
    request: {
      provider: "elevenlabs",
      agentId: process.env.ELEVENLABS_AGENT_ID ? "[configured]" : "[not configured]",
      agentPhoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID ? "[configured]" : "[not configured]",
      toNumber: redactPhone(destination),
      callRecordingEnabled: recordingEnabled,
      conversationInitiationClientData: {
        dynamicVariables: {
          ...dynamicVariables,
          secret__actor_token: "[redacted; generated only during execution]",
        },
      },
    },
  }, null, 2));
  process.exit(0);
}

const requiredProviderConfig = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_AGENT_ID",
  "ELEVENLABS_PHONE_NUMBER_ID",
  "VOICE_ACTOR_TOKEN_SECRET",
];
for (const name of requiredProviderConfig) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required when EXECUTE_VOICE_CALL=true.`);
}
if (process.env.VOICE_ACTOR_TOKEN_SECRET.trim().length < 32) {
  throw new Error("VOICE_ACTOR_TOKEN_SECRET must be at least 32 characters.");
}

const payload = Buffer.from(JSON.stringify({
  customerId,
  callId,
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
})).toString("base64url");
const signature = createHmac("sha256", process.env.VOICE_ACTOR_TOKEN_SECRET)
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
      ...dynamicVariables,
      secret__actor_token: actorToken,
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
