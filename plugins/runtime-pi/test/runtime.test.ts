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

  it("aborts an active Pi model stream", async () => {
    let streamStarted!: () => void;
    const started = new Promise<void>((resolve) => { streamStarted = resolve; });
    const model = scriptedModel(async function* (request) {
      streamStarted();
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      yield { type: "done", stopReason: "aborted" };
    });
    const runtime = new PiAgentRuntime(model, undefined);
    const run = runtime.start({
      runId: runId("run-abort"),
      sessionId: sessionId("session-abort"),
      cwd: process.cwd(),
      model: MODEL,
      systemPrompt: "test",
      messages: [userMessage("wait")],
    });

    await started;
    run.abort(new Error("test abort"));
    const events = await collect(run);
    const result = await run.result;

    expect(events.at(-1)).toEqual({ type: "run_end", stopReason: "aborted" });
    expect(result.stopReason).toBe("aborted");
  });

  it("processes queued steering before follow-up messages", async () => {
    const requests: ModelRequest[] = [];
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      yield { type: "text_delta", delta: `turn-${requests.length}` };
      yield { type: "done", stopReason: "stop" };
    });
    const runtime = new PiAgentRuntime(model, undefined);
    const run = runtime.start({
      runId: runId("run-queues"),
      sessionId: sessionId("session-queues"),
      cwd: process.cwd(),
      model: MODEL,
      systemPrompt: "test",
      messages: [userMessage("initial")],
    });
    run.steer(userMessage("steering"));
    run.followUp(userMessage("follow-up"));

    await collect(run);
    const result = await run.result;

    expect(requests).toHaveLength(2);
    const queuedUserMessages = requests[1]?.messages
      .filter((message) => message.role === "user")
      .map(messageText)
      .slice(-2);
    expect(queuedUserMessages).toEqual(["steering", "follow-up"]);
    expect(result.messages.filter((message) => message.role === "assistant")).toHaveLength(2);
  });

  it("executes independent tool calls in parallel", async () => {
    const requests: ModelRequest[] = [];
    let active = 0;
    let maxActive = 0;
    const tools: ToolService = {
      register: () => () => {},
      definitions: () => [{
        name: "parallel",
        description: "Parallel test",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      }],
      async execute(request) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { content: [text(String(request.input.value))] };
      },
    };
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      if (requests.length === 1) {
        yield {
          type: "tool_call",
          call: {
            type: "tool_call",
            id: toolCallId("parallel-1"),
            name: "parallel",
            arguments: { value: "one" },
          },
        };
        yield {
          type: "tool_call",
          call: {
            type: "tool_call",
            id: toolCallId("parallel-2"),
            name: "parallel",
            arguments: { value: "two" },
          },
        };
        yield { type: "done", stopReason: "tool_call" };
      } else {
        yield { type: "text_delta", delta: "done" };
        yield { type: "done", stopReason: "stop" };
      }
    });
    const run = new PiAgentRuntime(model, tools).start({
      runId: runId("run-parallel"),
      sessionId: sessionId("session-parallel"),
      cwd: process.cwd(),
      model: MODEL,
      systemPrompt: "test",
      messages: [userMessage("parallel")],
    });

    await collect(run);
    await run.result;
    expect(maxActive).toBe(2);
    expect(requests).toHaveLength(2);
  });

  it("returns tool failures to the model so it can recover", async () => {
    const requests: ModelRequest[] = [];
    const tools: ToolService = {
      register: () => () => {},
      definitions: () => [{
        name: "fail",
        description: "Always fail",
        inputSchema: { type: "object", additionalProperties: false },
      }],
      async execute() { throw new Error("expected failure"); },
    };
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      if (requests.length === 1) {
        yield {
          type: "tool_call",
          call: {
            type: "tool_call",
            id: toolCallId("failure-1"),
            name: "fail",
            arguments: {},
          },
        };
        yield { type: "done", stopReason: "tool_call" };
      } else {
        yield { type: "text_delta", delta: "recovered" };
        yield { type: "done", stopReason: "stop" };
      }
    });
    const run = new PiAgentRuntime(model, tools).start({
      runId: runId("run-failure"),
      sessionId: sessionId("session-failure"),
      cwd: process.cwd(),
      model: MODEL,
      systemPrompt: "test",
      messages: [userMessage("fail then recover")],
    });

    await collect(run);
    const result = await run.result;
    const toolMessage = requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage).toMatchObject({ role: "tool", isError: true });
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "recovered" }],
    });
  });

  it("normalizes provider stream failures as an error result", async () => {
    const model = scriptedModel(async function* () {
      yield { type: "text_delta", delta: "partial" };
      throw new Error("provider exploded");
    });
    const run = new PiAgentRuntime(model, undefined).start({
      runId: runId("run-provider-error"),
      sessionId: sessionId("session-provider-error"),
      cwd: process.cwd(),
      model: MODEL,
      systemPrompt: "test",
      messages: [userMessage("trigger error")],
    });

    const events = await collect(run);
    const result = await run.result;

    expect(events.at(-1)).toEqual({ type: "run_end", stopReason: "error" });
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("provider exploded");
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "partial" }],
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

function messageText(message: ModelRequest["messages"][number] | undefined): string {
  if (message?.role !== "user") return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}
