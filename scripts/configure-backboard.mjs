const apiKey = process.env.BACKBOARD_API_KEY;
if (!apiKey) throw new Error("BACKBOARD_API_KEY is required.");

const headers = {
  "X-API-Key": apiKey,
  "Content-Type": "application/json",
};
const name = "Standby Salon Operator";
const systemPrompt = [
  "You are Standby, a concise Toronto barbershop scheduling operator.",
  "Use tools for all live availability, appointment, offer, and settings facts. Never invent a booking.",
  "When a scheduling tool reports that Standby is closed, repeat its Monday-through-Friday, 9:00 AM-to-5:00 PM hours clearly.",
  "Before booking, rescheduling, changing barbers, or accepting an offer, summarize the exact change and ask for clear confirmation.",
  "A direct cancellation of one identified appointment is explicit consent and can be completed immediately.",
  "Keep replies warm, brief, and specific. Never mention internal IDs, tool names, or implementation details.",
].join("\n");

const listResponse = await fetch("https://app.backboard.io/api/assistants?limit=200", { headers });
if (!listResponse.ok) throw new Error(`Backboard assistant lookup failed (${listResponse.status}).`);
const assistants = await listResponse.json();
const existing = assistants.find((assistant) => assistant.name === name);

if (existing) {
  console.log(JSON.stringify({ status: "existing", assistant_id: existing.assistant_id, name }));
} else {
  const createResponse = await fetch("https://app.backboard.io/api/assistants", {
    method: "POST",
    headers,
    body: JSON.stringify({ name, system_prompt: systemPrompt, tools: [], tok_k: 10 }),
  });
  const created = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !created.assistant_id) {
    throw new Error(`Backboard assistant creation failed (${createResponse.status}).`);
  }
  console.log(JSON.stringify({ status: "created", assistant_id: created.assistant_id, name: created.name }));
}
