import { describe, expect, it } from "vitest";
import {
  deriveSessionMessages,
  foldSessionInbox,
  messageId,
  runId,
  sessionId,
  text,
  toolCallId,
  turnId,
  userMessage,
  type AgentMessage,
  type AgentRun,
  type AgentRuntime,
  type ContextService,
  type CompactionService,
  type RuntimeEvent,
  type RuntimeResult,
  type SessionStore,
} from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { DefaultAgentService } from "../src/index.js";

describe("DefaultAgentService", () => {
  it("persists additions before runtime and generated messages after completion", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
    const context: ContextService = {
      register() { return () => {}; },
      async prepare(request) {
        const addition = { role: "user" as const, content: request.prompt };
        return {
          systemPrompt: "test",
          messages: [...request.history, addition],
          additions: [addition],
        };
      },
    };
    let observedVersion = 0;
    const runtime: AgentRuntime = {
      start(request) {
        return completedRun(async () => {
          observedVersion = (await sessions.read(request.sessionId))?.version ?? 0;
          return {
            messages: [...request.messages, {
              role: "assistant",
              content: [text("done")],
            }],
            stopReason: "stop",
          };
        });
      },
    };
    const ids = ["run", "user-message", "assistant-message"];
    const service = new DefaultAgentService(
      sessions,
      context,
      runtime,
      async () => {},
      () => ids.shift() ?? "fallback",
    );

    const execution = await service.prompt({
      sessionId: sessionId("session"),
      cwd: "/workspace",
      model: { provider: "test", model: "test" },
      prompt: [text("hello")],
    });
    const result = await execution.result;

    expect(observedVersion).toBe(3);
    expect(result.session.version).toBe(5);
    expect(result.session.events.map((entry) => entry.event.type)).toEqual([
      "session.created",
      "message.appended",
      "run.started",
      "message.appended",
      "run.completed",
    ]);
  });

  it("persists runtime events through the awaited subscription without UI iteration", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
    const context = passthroughContext();
    const assistant = { role: "assistant" as const, content: [text("durable")] };
    const runtime: AgentRuntime = {
      start(request) {
        return new ControlledRun(async (publish) => {
          await publish({ type: "turn_start", index: 0 });
          const entered = request.messages.at(-1)! as Extract<AgentMessage, { role: "user" }>;
          await publish({ type: "pre_step", original: [entered], messages: [entered], rejected: false });
          await publish({ type: "request_header", reason: "initial", header: { config: { provider: "test", model: "test" }, system: "test" } });
          await publish({ type: "tool_dispatch", event: { type: "start", rootCallId: toolCallId("root"), parentCallId: toolCallId("root"), subCallId: toolCallId("root:code:0"), name: "read", arguments: { path: "a.txt" } } });
          await publish({ type: "tool_dispatch", event: { type: "settle", rootCallId: toolCallId("root"), parentCallId: toolCallId("root"), subCallId: toolCallId("root:code:0"), name: "read", arguments: { path: "a.txt" }, result: { content: [text("ok")] } } });
          const pending = { id: messageId("pending"), role: "user" as const, content: [text("pending")] };
          await publish({ type: "inbox_spliced", target: "next-turn", start: 0, inserted: [pending] });
          await publish({ type: "inbox_spliced", target: "next-turn", start: 0, removedCount: 1, inserted: [], outcome: "canceled" });
          await publish({ type: "text_delta", delta: "durable" });
          await publish({ type: "assistant_message", message: assistant, usage: { inputTokens: 8, outputTokens: 3, totalTokens: 14, cacheReadTokens: 2, reasoningTokens: 1, costUsd: 0.25, routes: [{ provider: "deepseek", model: "deepseek-chat" }] }, interrupted: true });
          await publish({ type: "turn_end", index: 0 });
          return { messages: [...request.messages, assistant], stopReason: "stop" };
        });
      },
    };
    const service = new DefaultAgentService(
      sessions,
      context,
      runtime,
      async () => {},
      sequentialIds(),
    );

    const execution = await service.prompt({
      sessionId: sessionId("durable-session"),
      cwd: "/workspace",
      model: { provider: "test", model: "test" },
      prompt: [text("hello")],
    });
    const result = await execution.result;

    expect(result.session.events.map((entry) => entry.event.type)).toEqual([
      "session.created",
      "message.appended",
      "run.started",
      "turn.started",
      "step.started",
      "message.appended",
      "request.header",
      "request.context",
      "tool/code-dispatch-start",
      "tool/code-dispatch",
      "agent/inbox.spliced",
      "agent/inbox.spliced",
      "assistant.chunk",
      "assistant.chunk",
      "assistant.chunk",
      "assistant.chunk",
      "assistant.chunk",
      "message.appended",
      "step.completed",
      "turn.completed",
      "run.completed",
    ]);
    expect(foldSessionInbox(result.session.events)).toEqual({ nextTurn: [], nextStep: [] });
    const chunks = result.session.events.filter((entry) => entry.event.type === "assistant.chunk");
    expect(chunks.map((entry) => entry.event.type === "assistant.chunk" ? entry.event.payload.chunk : undefined)).toMatchObject([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "durable" },
      { type: "block-end", index: 0, block: { type: "text", text: "durable" } },
      { type: "usage", usage: { inputTokens: 8, outputTokens: 3, cacheReadTokens: 2, reasoningTokens: 1, totalTokens: 14 } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
    const appendedAssistant = result.session.events.find((entry) => entry.event.type === "message.appended" && entry.event.payload.message.role === "assistant")?.event;
    expect(appendedAssistant).toMatchObject({ sourceEventSeqs: chunks.map((entry) => entry.sequence), payload: { message: { providerData: { dsh: { usage: { inputTokens: 8, outputTokens: 3, totalTokens: 14, cacheReadTokens: 2, reasoningTokens: 1 }, interrupted: true } } } } });
    expect((appendedAssistant as any).payload.message.providerData.dsh.usage).toEqual({ inputTokens: 8, outputTokens: 3, totalTokens: 14, cacheReadTokens: 2, reasoningTokens: 1 });
  });

  it("projects pre-step replacement and rejection onto durable Session history", async () => {
    for (const rejected of [false, true]) {
      const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
      const replacement = { id: messageId("rewritten"), role: "user" as const, content: [text("rewritten")] };
      const runtime: AgentRuntime = { start(request) { const original = request.messages.at(-1)! as Extract<AgentMessage, { role: "user" }>; return new ControlledRun(async (publish) => {
        await publish({ type: "turn_start", index: 0 });
        await publish({ type: "pre_step", original: [original], messages: rejected ? [] : [replacement], rejected });
        await publish({ type: "turn_end", index: 0 });
        return { messages: rejected ? [] : [replacement], stopReason: "stop" };
      }); } };
      const service = new DefaultAgentService(sessions, passthroughContext(), runtime, async () => {}, sequentialIds());
      const result = await (await service.prompt({ sessionId: sessionId(`pre-step-${rejected}`), cwd: "/workspace", model: { provider: "test", model: "test" }, prompt: [text("original")] })).result;
      expect(deriveSessionMessages(result.session)).toEqual(rejected ? [] : [replacement]);
      expect(result.session.events.some((entry) => entry.event.type === "surface.removed")).toBe(rejected);
    }
  });

  it("exposes only the exact currently active execution", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime: AgentRuntime = { start: () => new ControlledRun(async () => { await gate; return { messages: [], stopReason: "stop" }; }) };
    const service = new DefaultAgentService(sessions, passthroughContext(), runtime, async () => {}, sequentialIds());
    const id = sessionId("active-session");
    const execution = await service.prompt({ sessionId: id, cwd: "/workspace", model: { provider: "test", model: "test" }, prompt: [text("hello")] });
    expect(service.active(id)).toBe(execution);
    release();
    await execution.result;
    expect(service.active(id)).toBeUndefined();
  });

  it("persists queued injected context before assembling a waking prompt", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
    let observed: readonly AgentMessage[] = [];
    const runtime: AgentRuntime = { start: (request) => completedRun(async () => { observed = request.messages; return { messages: request.messages, stopReason: "stop" }; }) };
    const service = new DefaultAgentService(sessions, passthroughContext(), runtime, async () => {}, sequentialIds());
    const execution = await service.prompt({
      sessionId: sessionId("injected-session"), cwd: "/workspace", model: { provider: "test", model: "test" },
      injectedMessages: [{ id: messageId("injected"), role: "user", content: [text("context")] }], prompt: [text("wake")],
    });
    const result = await execution.result;
    expect(observed.map((message) => message.content[0])).toEqual([text("context"), text("wake")]);
    expect(result.session.events.map((entry) => entry.event.type)).toEqual([
      "session.created", "message.appended", "message.appended", "run.started", "run.completed",
    ]);
  });

  it("restores durable inbox entries into a new runtime execution", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z")); const id = sessionId("restored-inbox");
    await sessions.create({ id, cwd: "/workspace", initialEvents: [{ type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, inserted: [{ id: messageId("restored"), role: "user", content: [text("restored context")] }] } }] });
    let restored: readonly import("@seal-harness/core").PendingAgentMessage[] | undefined;
    const runtime: AgentRuntime = { start: (request) => { restored = request.pendingMessages; return completedRun(async () => ({ messages: request.messages, stopReason: "stop" })); } };
    const service = new DefaultAgentService(sessions, passthroughContext(), runtime, async () => {}, sequentialIds());
    const execution = await service.prompt({ sessionId: id, cwd: "/workspace", model: { provider: "test", model: "test" }, prompt: [text("wake")] });
    await execution.result;
    expect(restored).toEqual([{ id: "restored", placement: "steering", message: { id: "restored", role: "user", content: [text("restored context")] } }]);
  });

  it("queues a runtime projection while persisting the durable message representation", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z")); const listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
    let queued: import("@seal-harness/core").UserMessage | undefined; let settle!: (value: RuntimeResult) => void;
    const runtimeResult = new Promise<RuntimeResult>((resolve) => { settle = resolve; });
    const runtime: AgentRuntime = { start(request) { return {
      result: runtimeResult, abort() {}, followUp(message) { if (message.role === "user") queued = message; }, steer() {},
      pendingMessages() { return queued?.id === undefined ? [] : [{ id: queued.id, placement: "queued" as const, message: queued }]; },
      updatePendingMessage() { return "not-found" as const; }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {},
    }; } };
    const service = new DefaultAgentService(sessions, passthroughContext(), runtime, async () => {}, sequentialIds());
    const execution = await service.prompt({ sessionId: sessionId("projected-queue"), cwd: "/workspace", model: { provider: "test", model: "test" }, prompt: [text("initial")] });
    const id = messageId("queued-image");
    const durable = { id, role: "user" as const, content: [{ type: "attachment" as const, id: `sha256:${"a".repeat(64)}`, mimeType: "image/png" }], source: { kind: "user-rpc", rpcId: "rpc-image" } };
    const projected = { ...durable, content: [{ type: "image" as const, mimeType: "image/png", data: "AA==" }] };
    execution.followUp(durable, projected);
    expect(queued).toEqual(projected); expect(execution.pendingMessages?.()[0]?.message).toEqual(durable);
    for (const event of [{ type: "turn_start", index: 0 }, { type: "user_message", message: projected }, { type: "turn_end", index: 0 }] as RuntimeEvent[]) for (const listener of listeners) await listener(event);
    settle({ messages: [projected], stopReason: "stop" }); const result = await execution.result;
    expect(result.session.events.find((entry) => entry.event.type === "message.appended" && entry.event.payload.messageId === id)?.event).toMatchObject({ payload: { message: durable } });
  });

  it("stops later effects when a durability barrier fails and records the failed run", async () => {
    const backing = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
    let failAssistantOnce = true;
    const sessions: SessionStore = {
      create: (request) => backing.create(request),
      read: (id) => backing.read(id),
      list: () => backing.list(),
      fork: (request) => backing.fork(request),
      async append(request) {
        const hasAssistant = request.events.some((event) =>
          event.type === "message.appended" && event.payload.message.role === "assistant",
        );
        if (hasAssistant && failAssistantOnce) {
          failAssistantOnce = false;
          throw new Error("injected session failure");
        }
        return backing.append(request);
      },
    };
    let laterEffectRan = false;
    const assistant = { role: "assistant" as const, content: [text("generated")] };
    const runtime: AgentRuntime = {
      start(request) {
        return new ControlledRun(async (publish) => {
          try {
            await publish({ type: "turn_start", index: 0 });
            await publish({ type: "assistant_message", message: assistant });
            laterEffectRan = true;
            return { messages: [...request.messages, assistant], stopReason: "stop" };
          } catch (error) {
            return {
              messages: [...request.messages, assistant],
              stopReason: "error",
              errorMessage: error instanceof Error ? error.message : String(error),
            };
          }
        });
      },
    };
    const service = new DefaultAgentService(
      sessions,
      passthroughContext(),
      runtime,
      async () => {},
      sequentialIds(),
    );

    const execution = await service.prompt({
      sessionId: sessionId("failure-session"),
      cwd: "/workspace",
      model: { provider: "test", model: "test" },
      prompt: [text("hello")],
    });
    const result = await execution.result;

    expect(laterEffectRan).toBe(false);
    expect(result.runtime.stopReason).toBe("error");
    expect(result.session.events.some((entry) =>
      entry.event.type === "run.completed"
      && entry.event.payload.outcome === "failed"
      && entry.event.payload.error === "injected session failure",
    )).toBe(true);
    expect(result.session.events.some((entry) =>
      entry.event.type === "message.appended" && entry.event.payload.message.role === "assistant",
    )).toBe(true);
  });

  it("forks a session through the Agent service", async () => {
    const sessions = new MemorySessionStore();
    const sourceId = sessionId("source");
    await sessions.create({ id: sourceId, cwd: "/workspace" });
    await sessions.append({
      id: sourceId,
      expectedVersion: 1,
      events: [{
        type: "message.appended",
        payload: { messageId: messageId("source-message"), message: userMessage("one") },
      }],
    });

    const service = new DefaultAgentService(
      sessions,
      passthroughContext(),
      unusedRuntime(),
      async () => {},
      sequentialIds(),
    );
    const fork = await service.fork({
      sourceSessionId: sourceId,
      targetSessionId: sessionId("target"),
      throughVersion: 2,
    });

    expect(fork.id).toBe("target");
    expect(fork.events.map((entry) => entry.event.type)).toEqual([
      "session.created",
      "session.forked",
      "message.appended",
    ]);
  });

  it("persists compaction and supplies the replayable compacted context", async () => {
    const sessions = new MemorySessionStore();
    const id = sessionId("compact-session");
    await sessions.create({ id, cwd: "/workspace" });
    const original = [
      userMessage("one"),
      { role: "assistant" as const, content: [text("one answer")] },
      userMessage("two"),
      { role: "assistant" as const, content: [text("two answer")] },
      userMessage("three"),
    ];
    await sessions.append({
      id,
      expectedVersion: 1,
      events: original.map((message, index) => ({
        type: "message.appended" as const,
        payload: { messageId: messageId(`original-${index}`), message },
      })),
    });
    const summary = userMessage("summary");
    const compaction: CompactionService = {
      async compact(request) {
        expect(request.messages).toEqual(original);
        return { summaryMessage: summary, retainedMessages: original.slice(-2) };
      },
    };
    let runtimeInput: readonly AgentMessage[] = [];
    const runtime: AgentRuntime = {
      start(request) {
        runtimeInput = request.messages;
        return completedRun(async () => ({ messages: request.messages, stopReason: "stop" }));
      },
    };
    const service = new DefaultAgentService(
      sessions,
      passthroughContext(),
      runtime,
      async () => {},
      sequentialIds(),
      compaction,
    );

    const execution = await service.prompt({
      sessionId: id,
      cwd: "/workspace",
      model: { provider: "test", model: "test" },
      prompt: [text("new work")],
    });
    const result = await execution.result;

    expect(runtimeInput).toEqual([summary, ...original.slice(-2), userMessage("new work")]);
    expect(result.session.events.some((entry) => entry.event.type === "context.compacted")).toBe(true);
    expect(deriveSessionMessages(result.session)).toEqual(runtimeInput);
  });

  it("commits plugin prelude events atomically before prompt additions", async () => {
    const sessions = new MemorySessionStore(); const id = sessionId("prelude-session");
    const service = new DefaultAgentService(sessions, passthroughContext(), unusedRuntime(), async () => {}, sequentialIds());
    const execution = await service.prompt({ sessionId: id, cwd: "/workspace", model: { provider: "test", model: "test" }, prompt: [text("reminder")], preludeEvents: [{ type: "schedule.changed", payload: { version: 1, operation: "dispatch", id: "schedule-1" } }] });
    const result = await execution.result;
    expect(result.session.events.slice(1, 4).map(entry => entry.event.type)).toEqual(["schedule.changed", "message.appended", "run.started"]);
  });

  it("recovers interrupted tools without replaying them", async () => {
    const sessions = new MemorySessionStore();
    const id = sessionId("recovery-session");
    const interruptedRun = runId("interrupted-run");
    const interruptedTurn = turnId("interrupted-turn");
    const callId = toolCallId("unsafe-call");
    await sessions.create({ id, cwd: "/workspace" });
    await sessions.append({
      id,
      expectedVersion: 1,
      events: [
        {
          type: "run.started",
          payload: { runId: interruptedRun, model: { provider: "test", model: "test" } },
        },
        {
          type: "turn.started",
          payload: { runId: interruptedRun, turnId: interruptedTurn },
        },
        {
          type: "message.appended",
          payload: {
            messageId: messageId("assistant-tool-call"),
            runId: interruptedRun,
            turnId: interruptedTurn,
            message: {
              role: "assistant",
              content: [{
                type: "tool_call",
                id: callId,
                name: "unsafe_write",
                arguments: { path: "target.txt" },
              }],
            },
          },
        },
        {
          type: "tool.started",
          payload: {
            runId: interruptedRun,
            turnId: interruptedTurn,
            callId,
            name: "unsafe_write",
            input: { path: "target.txt" },
          },
        },
      ],
    });
    let runtimeInput: readonly AgentMessage[] = [];
    const runtime: AgentRuntime = {
      start(request) {
        runtimeInput = request.messages;
        return completedRun(async () => ({ messages: request.messages, stopReason: "stop" }));
      },
    };
    const service = new DefaultAgentService(
      sessions,
      passthroughContext(),
      runtime,
      async () => {},
      sequentialIds(),
    );

    const execution = await service.prompt({
      sessionId: id,
      cwd: "/workspace",
      model: { provider: "test", model: "test" },
      prompt: [text("continue safely")],
    });
    const result = await execution.result;

    const recoveryToolMessage = runtimeInput.find((message) =>
      message.role === "tool" && message.callId === callId,
    );
    expect(recoveryToolMessage).toMatchObject({ role: "tool", isError: true });
    expect(result.session.events.some((entry) =>
      entry.event.type === "run.completed"
      && entry.event.payload.runId === interruptedRun
      && entry.event.payload.outcome === "aborted",
    )).toBe(true);
    expect(result.session.events.some((entry) => entry.event.type === "turn.completed" && entry.event.payload.turnId === interruptedTurn && entry.event.payload.outcome === "interrupted")).toBe(true);
    expect((recoveryToolMessage?.content[0] as { text?: string }).text).toContain("outcome is unknown");
    expect(result.session.events.filter((entry) =>
      entry.event.type === "tool.started" && entry.event.payload.callId === callId,
    )).toHaveLength(1);
  });
});

function completedRun(factory: () => Promise<RuntimeResult>): AgentRun {
  return {
    result: factory(),
    abort() {},
    steer(_message: AgentMessage) {},
    followUp(_message: AgentMessage) {},
    subscribe() { return () => {}; },
    async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {},
  };
}

class ControlledRun implements AgentRun {
  readonly #listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  readonly result: Promise<RuntimeResult>;

  constructor(
    executor: (publish: (event: RuntimeEvent) => Promise<void>) => Promise<RuntimeResult>,
  ) {
    this.result = new Promise((resolve, reject) => {
      queueMicrotask(() => {
        executor((event) => this.#publish(event)).then(resolve, reject);
      });
    });
  }

  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #publish(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }

  abort() {}
  steer() {}
  followUp() {}
  async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {}
}

function passthroughContext(): ContextService {
  return {
    register() { return () => {}; },
    async prepare(request) {
      const addition = { role: "user" as const, content: request.prompt };
      return {
        systemPrompt: "test",
        messages: [...request.history, addition],
        additions: [addition],
      };
    },
  };
}

function sequentialIds(): () => string {
  let id = 0;
  return () => String(++id);
}

function unusedRuntime(): AgentRuntime {
  return {
    start(request) {
      return completedRun(async () => ({ messages: request.messages, stopReason: "stop" }));
    },
  };
}
