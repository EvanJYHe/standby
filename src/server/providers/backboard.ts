import { Agent } from "undici";
import { z } from "zod";

import type { ActorContext } from "../../domain/types.js";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface BackboardClientOptions {
  apiKey: string;
  assistantId: string;
  fetchImpl?: typeof fetch;
  apiIp?: string;
  systemPrompt?: string;
}

interface BackboardReplyInput {
  content: string;
  threadId?: string;
  actor: ActorContext;
  tools: ToolDefinition[];
  executeTool: (name: string, argumentsValue: unknown, actor: ActorContext) => Promise<unknown>;
}

interface BackboardReply {
  content: string;
  threadId: string;
}

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
  }),
});

const responseSchema = z.object({
  status: z.string(),
  thread_id: z.string(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallSchema).nullish().transform((calls) => calls ?? []),
});

const DEFAULT_SYSTEM_PROMPT = `You are Standby, a concise Toronto barbershop scheduling operator.
Use tools for all live availability, appointment, offer, and settings facts. Never invent a booking.
When a scheduling tool reports that Standby is closed, repeat its Monday-through-Friday, 9:00 AM-to-5:00 PM hours clearly.
Before booking, rescheduling, changing barbers, or accepting an offer, summarize the exact change and ask for clear confirmation.
A direct cancellation of one identified appointment is explicit consent and can be completed immediately.
Keep replies warm, brief, and specific. Never mention internal IDs, tool names, or implementation details.`;

export class BackboardClient {
  private readonly fetchImpl: typeof fetch;
  private readonly dispatcher: Agent | undefined;

  constructor(private readonly options: BackboardClientOptions) {
    this.dispatcher = options.fetchImpl === undefined && options.apiIp !== undefined
      ? new Agent({
          connect: {
            lookup: (_hostname, lookupOptions, callback) => {
              if (lookupOptions.all) {
                callback(null, [{ address: options.apiIp!, family: 4 }]);
                return;
              }
              callback(null, options.apiIp!, 4);
            },
          },
        })
      : undefined;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, {
      ...init,
      ...(this.dispatcher === undefined ? {} : { dispatcher: this.dispatcher }),
    } as RequestInit));
  }

  async close(): Promise<void> {
    await this.dispatcher?.close();
  }

  async reply(input: BackboardReplyInput): Promise<BackboardReply> {
    let response = await this.post("/threads/messages", {
      content: input.content,
      assistant_id: this.options.assistantId,
      ...(input.threadId === undefined ? {} : { thread_id: input.threadId }),
      system_prompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools: input.tools,
      memory: "off",
      stream: false,
    });

    for (let round = 0; round < 5; round += 1) {
      if (response.status !== "REQUIRES_ACTION" || response.tool_calls.length === 0) {
        return {
          content: response.content?.trim() || "I couldn't finish that request. Please try again.",
          threadId: response.thread_id,
        };
      }
      const toolOutputs = await Promise.all(response.tool_calls.map(async (toolCall) => {
        let parsedArguments: unknown;
        try {
          parsedArguments = typeof toolCall.function.arguments === "string"
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;
        } catch {
          parsedArguments = {};
        }
        let output: unknown;
        try {
          output = await input.executeTool(toolCall.function.name, parsedArguments, input.actor);
        } catch {
          output = { type: "error", code: "TOOL_ERROR", message: "That action could not be completed safely." };
        }
        return {
          tool_call_id: toolCall.id,
          output: JSON.stringify(output),
        };
      }));
      response = await this.post("/threads/tool-outputs", {
        thread_id: response.thread_id,
        tool_outputs: toolOutputs,
      });
    }

    throw new Error("Backboard requested too many tool rounds.");
  }

  private async post(path: string, body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://app.backboard.io/api${path}`, {
        method: "POST",
        headers: {
          "X-API-Key": this.options.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("Backboard is temporarily unavailable.");
    }
    if (!response.ok) {
      throw new Error("Backboard is temporarily unavailable.");
    }
    try {
      return responseSchema.parse(await response.json());
    } catch {
      throw new Error("Backboard returned an invalid response.");
    }
  }
}
