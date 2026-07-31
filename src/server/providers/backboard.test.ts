import { describe, expect, it } from "vitest";

import type { ActorContext } from "../../domain/types.js";
import { BackboardClient } from "./backboard.js";

describe("BackboardClient", () => {
  it("runs an OpenAI-style tool loop with memory off and returns the persistent thread", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const responses = [
      {
        status: "REQUIRES_ACTION",
        thread_id: "thread-alex",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "get_my_appointments", arguments: "{}" },
        }],
      },
      {
        status: "COMPLETED",
        thread_id: "thread-alex",
        content: "You have one appointment with Jeremy at 6 PM.",
        tool_calls: null,
      },
    ];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const actor: ActorContext = { provider: "telegram", customerId: "alex" };
    const executed: string[] = [];
    const client = new BackboardClient({
      apiKey: "test-key",
      assistantId: "assistant-1",
      fetchImpl,
    });

    const reply = await client.reply({
      content: "When is my appointment?",
      actor,
      tools: [{
        type: "function",
        function: {
          name: "get_my_appointments",
          description: "List the authenticated customer's appointments.",
          parameters: { type: "object", properties: {} },
        },
      }],
      executeTool: async (name) => {
        executed.push(name);
        return { appointments: [{ id: "appt-1" }] };
      },
    });

    expect(reply).toEqual({
      content: "You have one appointment with Jeremy at 6 PM.",
      threadId: "thread-alex",
    });
    expect(executed).toEqual(["get_my_appointments"]);
    expect(requests[0]).toMatchObject({
      url: "https://app.backboard.io/api/threads/messages",
      body: { assistant_id: "assistant-1", memory: "off", content: "When is my appointment?" },
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("customer_id");
    expect(requests[1]).toMatchObject({
      url: "https://app.backboard.io/api/threads/tool-outputs",
      body: {
        thread_id: "thread-alex",
        tool_outputs: [{ tool_call_id: "call-1", output: JSON.stringify({ appointments: [{ id: "appt-1" }] }) }],
      },
    });
  });

  it("continues an existing customer thread and surfaces safe provider failures", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const client = new BackboardClient({
      apiKey: "test-key",
      assistantId: "assistant-1",
      fetchImpl: async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ detail: "upstream stack trace" }), { status: 503 });
      },
    });

    await expect(client.reply({
      content: "Hello",
      threadId: "thread-josh",
      actor: { provider: "telegram", customerId: "josh" },
      tools: [],
      executeTool: async () => ({}),
    })).rejects.toThrow("Backboard is temporarily unavailable");
    expect(requestBodies[0]).toMatchObject({ thread_id: "thread-josh" });
  });

  it("accepts completed provider responses with null tool calls", async () => {
    const client = new BackboardClient({
      apiKey: "test-key",
      assistantId: "assistant-1",
      fetchImpl: async () => new Response(JSON.stringify({
        status: "COMPLETED",
        thread_id: "thread-live-response",
        content: "Hello from Standby.",
        tool_calls: null,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    await expect(client.reply({
      content: "Hello",
      actor: { provider: "worker", customerId: "sarah" },
      tools: [],
      executeTool: async () => ({}),
    })).resolves.toEqual({
      content: "Hello from Standby.",
      threadId: "thread-live-response",
    });
  });
});
