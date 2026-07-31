import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const required = ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "PUBLIC_BASE_URL"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const publicBaseUrl = new URL(process.env.PUBLIC_BASE_URL);
if (publicBaseUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(publicBaseUrl.hostname)) {
  throw new Error("PUBLIC_BASE_URL must be the public HTTPS URL for the local tunnel.");
}

const prompt = `You are Standby's telephone scheduling operator for one Toronto barbershop. Be warm, confident, and concise. Speak in short natural sentences and ask only one question at a time.

Authenticated caller: {{customer_name}}
Current appointments: {{appointment_summary}}
Shop timezone: {{timezone}}
Active offer reference: {{offer_id}}
Offer context: {{barber_name}}, {{service_name}}, current time {{old_time}}, proposed time {{proposed_time}}, discount {{discount_percent}} percent.

OPERATING RULES
- Use tools for every fact about services, hours, availability, appointments, bookings, cancellations, reschedules, and offers. Never invent availability, identifiers, prices, or appointment state.
- Never say internal IDs, tool names, authentication details, or secrets aloud.
- For a new booking, gather the service, date, preferred time or time range, and barber preference. Ask one short question at a time.
- Call get_shop_info when you need service or barber identifiers. Use the exact lowercase service_id and barber_id returned by the tool, never a display name.
- Once the service and date are known, call get_availability. Offer at most three live slots that best match the caller's stated availability.
- Before booking or rescheduling, restate the exact service, barber, date, and time, and ask for a clear yes. Call the mutation with confirmed=true only after that yes. A confirmed=false result is a prompt to obtain confirmation, not a completed change.
- If the caller asks what Standby offers, call get_shop_info. If they ask about their booking, call get_my_appointments.
- A direct, unambiguous request to cancel one identified appointment is sufficient consent. If more than one appointment could match, clarify first.
- When offer_id is present, help with that active offer. Restate the proposed time and barber and require a clear yes before calling respond_to_offer with response=accept and confirmed=true. A clear no may be sent immediately with response=decline and confirmed=true.
- If a tool reports a stale or unavailable slot, apologize briefly and offer to check current availability.
- If the caller is unlinked, explain that you can answer shop questions but cannot change appointments until their phone is linked.
- Do not claim a change succeeded unless the tool returns a committed result.
- When the caller is finished, close politely without adding new questions.`;

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const agent = await client.conversationalAi.agents.get(process.env.ELEVENLABS_AGENT_ID);
const toolIds = agent.conversationConfig?.agent?.prompt?.toolIds ?? [];
if (toolIds.length === 0) throw new Error("The ElevenLabs agent has no assigned scheduling tools.");
const { tools: _legacyTools, ...existingPrompt } = agent.conversationConfig.agent?.prompt ?? {};

const updatedTools = [];
for (const toolId of toolIds) {
  const tool = await client.conversationalAi.tools.get(toolId);
  if (tool.toolConfig.type !== "webhook") continue;
  const name = tool.toolConfig.name;
  await client.conversationalAi.tools.update(toolId, {
    toolConfig: {
      ...tool.toolConfig,
      apiSchema: {
        ...tool.toolConfig.apiSchema,
        url: new URL(`/webhooks/elevenlabs/tools/${name}`, publicBaseUrl).toString(),
        requestHeaders: {
          ...tool.toolConfig.apiSchema.requestHeaders,
          Authorization: { variableName: "secret__actor_token" },
        },
      },
    },
    ...(tool.responseMocks === undefined ? {} : { responseMocks: tool.responseMocks }),
  });
  updatedTools.push(name);
}

await client.conversationalAi.agents.update(process.env.ELEVENLABS_AGENT_ID, {
  conversationConfig: {
    ...agent.conversationConfig,
    agent: {
      ...agent.conversationConfig.agent,
      firstMessage: "{{offer_message}}",
      prompt: {
        ...existingPrompt,
        prompt,
        timezone: "America/Toronto",
      },
    },
  },
  versionDescription: "Local availability interview and confirmed appointment booking",
});

console.log(JSON.stringify({
  status: "configured",
  agent: agent.name,
  publicBaseUrl: publicBaseUrl.origin,
  updatedTools,
}));
