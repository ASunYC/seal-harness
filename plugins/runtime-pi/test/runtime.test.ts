import { describe, expect, it, vi } from "vitest";
import type {
  ModelInfo,
  ModelRequest,
  ModelService,
  ModelStreamEvent,
  ToolService,
} from "@piharness/core";
import {
  runId,
  sessionId,
  text,
  toolCallId,
  userMessage,
} from "@piharness/core";
import { PiAgentRuntime } from "../src/index.js";

const MODEL: ModelInfo = {
  provider: "scripted",
  model: "test-model",
  displayName: "Test Model",
  contextWindow: 32_000,
  maxOutputTokens: 4_096,
  supportsReasoning: true,
};

describe("PiAgentRuntime", () => {
  it("runs a text response through the real Pi Agent loop", async () => {
    const requests: ModelRequest[] = [];
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      yield { type: "text_delta", delta: "hello" };
      yield {
        type: "usage",
        usage: { inputTokens: 3, outputTokens: 1 },
      };
      yield { type: "done", stopReason: "stop" };
    });
    const runtime = new PiAgentRuntime(model, undefined);
    const run = runtime.start({
      runId: runId("run-1"),
      sessionId: sessionId("session-1"),
      cwd: process.cwd(),
      model: MODEL,
      reasoning: "high",
      systemPrompt: "Be concise.",
      messages: [userMessage("Hi")],
    });

    const events = await collect(run);
    const result = await run.result;

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      systemPrompt: "Be concise.",
      reasoning: "high",
    });
    expect(events.map((event) => event.type)).toContain("text_delta");
    expect(events.at(-1)).toEqual({ type: "run_end", stopReason: "stop" });
    expect(result).toMatchObject({
      stopReason: "stop",
      usage: { inputTokens: 3, outputTokens: 1 },
    });
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("executes a tool through ToolService and continues the Pi loop", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn(async () => ({ content: [text("echo:ping")] }));
    const tools: ToolService = {
      register: () => () => {},
      definitions: () => [{
        name: "echo",
        description: "Echo text",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      }],
      execute,
    };
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      if (requests.length === 1) {
        yield {
          type: "tool_call",
          call: {
            type: "tool_call",
            id: toolCallId("call-1"),
            name: "echo",
            arguments: { value: "ping" },
          },
        };
        yield { type: "done", stopReason: "tool_call" };
        return;
      }
      yield { type: "text_delta", delta: "finished" };
      yield { type: "done", stopReason: "stop" };
    });
    const runtime = new PiAgentRuntime(model, tools);
    const run = runtime.start({
      runId: runId("run-tools"),
      sessionId: sessionId("session-tools"),
      cwd: process.cwd(),
      model: MODEL,
      systemPrompt: "Use tools.",
      messages: [userMessage("echo ping")],
    });

    const events = await collect(run);
    const result = await run.result;

    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.some((message) => message.role === "tool")).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      name: "echo",
      input: { value: "ping" },
    }));
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(1);
    expect(result.stopReason).toBe("stop");
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "finished" }],
    });
  });
});

function scriptedModel(
  respond: (request: ModelRequest) => AsyncIterable<ModelStreamEvent>,
): ModelService {
  return {
    async list() { return [MODEL]; },
    async get(ref) {
      return ref.provider === MODEL.provider && ref.model === MODEL.model ? MODEL : undefined;
    },
    stream: respond,
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
