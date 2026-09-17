import { describe, expect, it, vi } from "vitest";
import type {
  ModelInfo,
  ModelRequest,
  ModelService,
  ModelStreamEvent,
  ToolService,
} from "@seal-harness/core";
import {
  messageId,
  runId,
  sessionId,
  text,
  toolCallId,
  userMessage,
} from "@seal-harness/core";
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
  it.each(["one-at-a-time", "all"] as const)("preserves mixed queued blocks and IDs in %s mode", async mode => {
    let release!: () => void; let announce!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { announce = resolve; });
    const requests: ModelRequest[] = [];
    const service = scriptedModel(async function* (request) {
      requests.push(request);
      if (requests.length === 1) { announce(); await gate; }
      yield { type: "text_delta", delta: "done" }; yield { type: "done", stopReason: "stop" };
    });
    const run = new PiAgentRuntime(service, undefined, { followUpMode: mode, steeringMode: mode }).start({
      runId: runId(`mixed-${mode}`), sessionId: sessionId(`mixed-${mode}`), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [userMessage("start")],
    });
    await started;
    const content = [text("first"), { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" }, text("last")];
    const queued = { role: "user" as const, id: messageId("mixed-queued"), source: { kind: "user-rpc", rpcId: "queued" }, content };
    const steering = { ...queued, id: messageId("mixed-steering"), source: { kind: "user-rpc", rpcId: "steering" } };
    const second = { ...queued, id: messageId("mixed-second") };
    run.followUp(queued); run.followUp(second); run.steer(steering);
    release(); const events = await collect(run); const result = await run.result;
    const delivered = result.messages.filter(message => message.role === "user" && message.id?.startsWith("mixed-"));
    expect(delivered).toEqual([steering, queued, second]);
    expect(run.pendingMessages?.()).toEqual([]);
    expect(events.filter(event => event.type === "user_message").map(event => event.message.id)).toEqual([undefined, steering.id, queued.id, second.id]);
    expect(requests.at(-1)?.messages.filter(message => message.role === "user" && message.id?.startsWith("mixed-"))).toEqual([steering, queued, second]);
  });

  it("rejects unsupported queued content before mutating the pending records", async () => {
    let release!: () => void; let announce!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { announce = resolve; });
    const service = scriptedModel(async function* () { announce(); await gate; yield { type: "done", stopReason: "stop" }; });
    const run = new PiAgentRuntime(service, undefined).start({ runId: runId("queue-validate"), sessionId: sessionId("queue-validate"),
      cwd: process.cwd(), model: MODEL, systemPrompt: "test", messages: [userMessage("start")] });
    await started;
    try {
      expect(() => run.followUp({ role: "user", content: [{ type: "attachment" } as never] })).toThrow("resolved text/image");
      expect(run.pendingMessages?.()).toEqual([]);
    } finally { release(); }
    await collect(run); expect((await run.result).stopReason).toBe("stop");
  });

  it.each(["preStep", "request"] as const)("fails closed when a %s compatibility extension throws", async (hook) => {
    const stream = vi.fn(async function* () { yield { type: "done" as const, stopReason: "stop" as const }; });
    const run = new PiAgentRuntime(scriptedModel(stream), undefined).start({
      runId: runId(`extension-error-${hook}`), sessionId: sessionId(`extension-error-${hook}`), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [userMessage("do not bypass policy")],
      hooks: { [hook]: async () => { throw new Error("policy unavailable"); } },
    });
    await collect(run);
    expect(stream).not.toHaveBeenCalled();
    expect(await run.result).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("policy unavailable") });
  });
  it("runs a text response through the real Pi Agent loop", async () => {
    const requests: ModelRequest[] = [];
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      yield { type: "text_delta", delta: "hello" };
      yield {
        type: "usage",
        usage: { inputTokens: 3, outputTokens: 1, reasoningTokens: 1 },
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
      maxTokens: 1234,
      systemPrompt: "Be concise.",
      messages: [{ ...userMessage("Hi"), source: { kind: "user-rpc", rpcId: "request-1" } }],
    });

    const events = await collect(run);
    const result = await run.result;

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      systemPrompt: expect.stringContaining("Be concise."),
      reasoning: "high",
      maxOutputTokens: 1234,
      messages: [{ role: "user", source: { kind: "user-rpc", rpcId: "request-1" } }],
    });
    expect(events.map((event) => event.type)).toContain("text_delta");
    expect(events).toContainEqual({ type: "pre_step", original: [], messages: [], rejected: false });
    expect(events).toContainEqual({ type: "runtime_activity", phase: "preparing" });
    expect(events).toContainEqual({ type: "runtime_activity", phase: "waiting-model" });
    expect(events.findIndex(event => event.type === "runtime_activity" && event.phase === "preparing")).toBeLessThan(events.findIndex(event => event.type === "pre_step"));
    expect(events.findIndex(event => event.type === "runtime_activity" && event.phase === "waiting-model")).toBeLessThan(events.findIndex(event => event.type === "text_delta"));
    expect(events.findIndex(event => event.type === "pre_step")).toBeLessThan(events.findIndex(event => event.type === "text_delta"));
    expect(events).toContainEqual({ type: "request_header", reason: "initial", header: { config: { provider: "scripted", model: "test-model", reasoningEffort: "high", maxTokens: 1234 }, system: "Be concise." } });
    expect(events).toContainEqual(expect.objectContaining({ type: "turn_end", firstTokenAt: expect.any(Number), stopReason: "stop" }));
    expect(events.at(-1)).toEqual({ type: "run_end", stopReason: "stop" });
    expect(result).toMatchObject({
      stopReason: "stop",
      usage: { inputTokens: 3, outputTokens: 1, reasoningTokens: 1 },
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
    run.followUp(userMessage("preserved")); const preservedId = run.pendingMessages?.()[0]?.id;
    run.abort(new Error("test abort"));
    const events = await collect(run);
    const result = await run.result;

    expect(events.at(-1)).toEqual({ type: "run_end", stopReason: "aborted" });
    expect(result.stopReason).toBe("aborted");
    expect(run.pendingMessages?.()).toMatchObject([{ id: preservedId, placement: "queued", message: { content: [{ text: "preserved" }] } }]);
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

  it("edits, removes, and promotes the actual live Pi inbox by stable message id", async () => {
    const requests: ModelRequest[] = []; let release!: () => void; let announce!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { announce = resolve; });
    const model = scriptedModel(async function* (request) {
      requests.push(request); if (requests.length === 1) { announce(); await gate; }
      yield { type: "text_delta", delta: `turn-${requests.length}` }; yield { type: "done", stopReason: "stop" };
    });
    const run = new PiAgentRuntime(model, undefined).start({ runId: runId("run-edit-queue"), sessionId: sessionId("session-edit-queue"), cwd: process.cwd(), model: MODEL, systemPrompt: "test", messages: [userMessage("initial")] });
    await started;
    const snapshots: string[][] = []; run.subscribePending?.((items) => snapshots.push(items.map((item) => `${item.placement}:${messageText(item.message)}`)));
    run.followUp(userMessage("first")); run.followUp(userMessage("second"));
    const [first, second] = run.pendingMessages?.() ?? []; expect(first?.id).toBeDefined(); expect(second?.id).toBeDefined();
    expect(run.updatePendingMessage?.(first!.id, { kind: "edit", content: [text("edited")] })).toBe("updated");
    expect(run.updatePendingMessage?.(second!.id, { kind: "remove" })).toBe("updated");
    expect(run.updatePendingMessage?.(first!.id, { kind: "steer" })).toBe("updated");
    expect(run.pendingMessages?.()).toMatchObject([{ id: first!.id, placement: "steering", message: { content: [{ text: "edited" }] } }]);
    release(); const events = await collect(run); await run.result;
    expect(events.filter((event) => event.type === "inbox_spliced").length).toBeGreaterThanOrEqual(5);
    expect(events.at(-1)?.type).toBe("run_end");
    expect(requests).toHaveLength(2); expect(requests[1]?.messages.filter((message) => message.role === "user").map(messageText).at(-1)).toBe("edited");
    expect(snapshots.at(-1)).toEqual([]);
  });

  it("atomically splices the live Pi inbox with stable ordering and duplicate rejection", async () => {
    let release!: () => void; let announce!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { announce = resolve; });
    const model = scriptedModel(async function* (request) { announce(); await gate; yield { type: "text_delta", delta: "done" }; yield { type: "done", stopReason: "stop" }; });
    const run = new PiAgentRuntime(model, undefined).start({ runId: runId("run-splice-queue"), sessionId: sessionId("session-splice-queue"), cwd: process.cwd(), model: MODEL, systemPrompt: "test", messages: [userMessage("initial")] });
    await started;
    run.followUp({ id: messageId("one"), role: "user", content: [text("one")] });
    run.followUp({ id: messageId("two"), role: "user", content: [text("two")] });
    const removed = run.splicePending?.("queued", 0, 1, [{ id: messageId("zero"), role: "user", content: [text("zero")] }]);
    expect(removed?.map(messageText)).toEqual(["one"]);
    expect(run.pendingMessages?.().map((entry) => messageText(entry.message))).toEqual(["zero", "two"]);
    expect(() => run.splicePending?.("steering", 0, 0, [{ id: messageId("two"), role: "user", content: [text("duplicate")] }])).toThrow("already queued");
    release(); await collect(run); await run.result;
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

  it.each([false, true])("returns tool failures to the model so it can recover (partial output: %s)", async (withProgress) => {
    const requests: ModelRequest[] = [];
    const tools: ToolService = {
      register: () => () => {},
      definitions: () => [{
        name: "fail",
        description: "Always fail",
        inputSchema: { type: "object", additionalProperties: false },
      }],
      async execute(request) {
        if(withProgress) request.reportProgress?.([text('partial-output:'+ 'x'.repeat(60_000))]);
        throw new Error("expected failure");
      },
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
    if(withProgress) {
      const output=toolMessage!.content.filter(block=>block.type==='text').map(block=>block.text).join('');
      expect(output).toContain('expected failure');expect(output).toContain('partial-output:');
      expect(output.length).toBeLessThan(51_000);
    }
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "recovered" }],
    });
  });

  it("honors any concluding result across a parallel tool batch", async () => {
    const requests: ModelRequest[] = [];
    const tools: ToolService = {
      register: () => () => {},
      definitions: () => ["finish", "observe"].map((name) => ({
        name, description: name, inputSchema: { type: "object", additionalProperties: false },
      })),
      async execute(request) {
        return { content: [text(request.name)], ...(request.name === "finish" ? { concludesTurn: true as const } : {}) };
      },
    };
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      yield { type: "tool_call", call: { type: "tool_call", id: toolCallId("finish-1"), name: "finish", arguments: {} } };
      yield { type: "tool_call", call: { type: "tool_call", id: toolCallId("observe-1"), name: "observe", arguments: {} } };
      yield { type: "done", stopReason: "tool_call" };
    });
    const run = new PiAgentRuntime(model, tools).start({ runId: runId("run-conclude"), sessionId: sessionId("session-conclude"), cwd: process.cwd(), model: MODEL, systemPrompt: "test", messages: [userMessage("finish")] });

    const events = await collect(run);
    await run.result;
    expect(requests).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(2);
  });

  it("drains deferred tool context before honoring conclusion", async () => {
    const requests: ModelRequest[] = [];
    const tools: ToolService = {
      register: () => () => {},
      definitions: () => [{ name: "finish", description: "finish", inputSchema: { type: "object", additionalProperties: false } }],
      async execute() { return { content: [text("done")], additionalContexts: [userMessage("deferred")], concludesTurn: true }; },
    };
    const model = scriptedModel(async function* (request) {
      requests.push(request);
      if (requests.length === 1) {
        yield { type: "tool_call", call: { type: "tool_call", id: toolCallId("finish-context"), name: "finish", arguments: {} } };
        yield { type: "done", stopReason: "tool_call" };
      } else {
        yield { type: "text_delta", delta: "context handled" };
        yield { type: "done", stopReason: "stop" };
      }
    });
    const run = new PiAgentRuntime(model, tools).start({ runId: runId("run-deferred"), sessionId: sessionId("session-deferred"), cwd: process.cwd(), model: MODEL, systemPrompt: "test", messages: [userMessage("finish")] });

    await collect(run);
    await run.result;
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.filter((message) => message.role === "user").map(messageText)).toContain("deferred");
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

  it("applies a runtime request hook at the actual provider boundary", async () => {
    const requests: ModelRequest[] = [];
    const replacement: ModelInfo = { ...MODEL, provider: "replacement", model: "switched", maxOutputTokens: 2048 };
    const service: ModelService = {
      async list() { return [MODEL, replacement]; },
      async get(ref) { return [MODEL, replacement].find((entry) => entry.provider === ref.provider && entry.model === ref.model); },
      async *stream(request) { requests.push(request); yield { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } }; yield { type: "done", stopReason: "stop", replayState: { response: ["opaque", 1] } }; },
    };
    const hookInputs: unknown[] = [];
    const request = vi.fn(async ({ turn, step, config }: any) => {
      hookInputs.push({ turn, step, config });
      return { model: { provider: "replacement", model: "switched" }, reasoning: "low" as const, maxTokens: 777 };
    });
    const run = new PiAgentRuntime(service, undefined).start({
      runId: runId("run-request-hook"), sessionId: sessionId("session-request-hook"), cwd: process.cwd(), model: MODEL,
      reasoning: "high", maxTokens: 1234, systemPrompt: "test", messages: [userMessage("switch")], hooks: { request },
    });
    await collect(run); const result = await run.result;
    expect(request).toHaveBeenCalledOnce();
    expect(hookInputs).toEqual([{ turn: 1, step: 1, config: { model: { provider: "scripted", model: "test-model" }, reasoning: "high", maxTokens: 1234 } }]);
    expect(requests[0]).toMatchObject({ model: { provider: "replacement", model: "switched" }, reasoning: "low", maxOutputTokens: 777 });
    expect(result.usage).toMatchObject({ routes: [{ provider: "replacement", model: "switched" }] });
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", replayState: { response: ["opaque", 1] } });
  });

  it("notifies request-error without allowing compatibility code to force a retry", async () => {
    const requests: ModelRequest[] = []; let attempts = 0;
    const service = scriptedModel(async function* (request) {
      requests.push(request); attempts += 1;
      if (attempts === 1) { yield { type: "text_delta", delta: "discarded" }; yield { type: "usage", usage: { inputTokens: 3, outputTokens: 1, totalTokens: 5, cacheReadTokens: 1, reasoningTokens: 1 } }; throw new Error("temporary outage"); }
      yield { type: "text_delta", delta: "recovered" };
      yield { type: "usage", usage: { inputTokens: 4, outputTokens: 2, totalTokens: 8, cacheReadTokens: 2, reasoningTokens: 1 } };
      yield { type: "done", stopReason: "stop" };
    });
    const select = vi.fn(async ({ config }: any) => config);
    const requestError = vi.fn(async ({ turn, step, provider, failure }: any) => {
      expect({ turn, step, provider, failure }).toEqual({ turn: 1, step: 1, provider: "scripted", failure: { message: "temporary outage", code: "UNKNOWN" } });
      return "retry" as const;
    });
    const run = new PiAgentRuntime(service, undefined).start({
      runId: runId("run-request-retry"), sessionId: sessionId("session-request-retry"), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [userMessage("retry")], hooks: { request: select, requestError },
    });
    await collect(run); const result = await run.result;
    expect(requestError).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledOnce(); expect(requests).toHaveLength(1);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("temporary outage");
  });

  it("lets the native SDK retry a transient provider failure without a compatibility retry decision", async () => {
    let attempts = 0;
    const requestError = vi.fn(async () => undefined);
    const service = scriptedModel(async function* () {
      if (++attempts === 1) throw new Error("503 Service Unavailable");
      yield { type: "text_delta", delta: "native recovery" };
      yield { type: "done", stopReason: "stop" };
    });
    const run = new PiAgentRuntime(service, undefined).start({
      runId: runId("native-retry"), sessionId: sessionId("native-retry"), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [userMessage("retry")], hooks: { requestError },
    });
    await collect(run);
    expect(attempts).toBe(2);
    expect(requestError).toHaveBeenCalledOnce();
    expect(await run.result).toMatchObject({ stopReason: "stop", messages: expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "native recovery" }] }),
    ]) });
  });

  it("awaits turn-stopping and re-reads steering before closing the run", async () => {
    const requests: ModelRequest[] = [];
    const service = scriptedModel(async function* (request) {
      requests.push(request);
      yield { type: "text_delta", delta: requests.length === 1 ? "first" : "second" };
      yield { type: "done", stopReason: "stop" };
    });
    let run!: ReturnType<PiAgentRuntime["start"]>; let stoppingCalls = 0;
    const turnStopping = vi.fn(async () => {
      stoppingCalls += 1;
      if (stoppingCalls === 1) run.steer({ ...userMessage("one more step"), id: messageId("turn-stopping-steer") });
    });
    run = new PiAgentRuntime(service, undefined).start({
      runId: runId("run-turn-stopping"), sessionId: sessionId("session-turn-stopping"), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [userMessage("start")], hooks: { turnStopping },
    });
    await collect(run); const result = await run.result;
    expect(turnStopping).toHaveBeenCalledTimes(2); expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.filter((message) => message.role === "user").map(messageText)).toContain("one more step");
    expect(result.stopReason).toBe("stop");
  });

  it("replaces claimed input through pre-step before provider I/O", async () => {
    const requests: ModelRequest[] = [];
    const service = scriptedModel(async function* (request) { requests.push(request); yield { type: "done", stopReason: "stop" }; });
    const original = { ...userMessage("original"), id: messageId("pre-step-original") };
    const replacement = { ...userMessage("replacement"), id: messageId("pre-step-replacement") };
    const preStep = vi.fn(async ({ turn, step, messages }: any) => {
      expect({ turn, step, messages }).toEqual({ turn: 1, step: 1, messages: [original] });
      return { kind: "enter" as const, messages: [replacement] };
    });
    const run = new PiAgentRuntime(service, undefined).start({
      runId: runId("run-pre-step"), sessionId: sessionId("session-pre-step"), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [original], initialStepMessages: [original], hooks: { preStep },
    });
    await collect(run); const result = await run.result;
    expect(requests[0]?.messages.filter((message) => message.role === "user").map(messageText)).toEqual(["replacement"]);
    expect(result.messages[0]).toMatchObject({ role: "user", id: "pre-step-replacement" });
  });

  it("rejects pre-step without calling the provider or persisting an empty assistant", async () => {
    const stream = vi.fn(async function* () { yield { type: "done" as const, stopReason: "stop" as const }; });
    const service = scriptedModel(stream);
    const original = { ...userMessage("blocked"), id: messageId("pre-step-blocked") };
    const run = new PiAgentRuntime(service, undefined).start({
      runId: runId("run-pre-step-reject"), sessionId: sessionId("session-pre-step-reject"), cwd: process.cwd(), model: MODEL,
      systemPrompt: "test", messages: [original], initialStepMessages: [original], hooks: { preStep: async () => ({ kind: "reject" }) },
    });
    const events = await collect(run); const result = await run.result;
    expect(stream).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(result).toMatchObject({ messages: [], stopReason: "stop" });
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
