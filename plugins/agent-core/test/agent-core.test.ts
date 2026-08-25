import { describe, expect, it } from "vitest";
import {
  deriveSessionMessages,
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
} from "@piharness/core";
import { MemorySessionStore } from "@piharness/session-memory";
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
          await publish({ type: "assistant_message", message: assistant });
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
      "message.appended",
      "turn.completed",
      "run.completed",
    ]);
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
      && entry.event.payload.outcome === "failed",
    )).toBe(true);
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
