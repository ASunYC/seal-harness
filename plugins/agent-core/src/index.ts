import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  agentServiceToken,
  compactionServiceToken,
  contextServiceToken,
  deriveSessionMessages,
  messageId,
  runId as asRunId,
  runtimeToken,
  sessionId as asSessionId,
  sessionStoreToken,
  text,
  turnId as asTurnId,
  type AgentExecution,
  type AgentExecutionResult,
  type AgentForkRequest,
  type AgentMessage,
  type AgentPromptRequest,
  type AgentRun,
  type AgentService,
  type CompactionService,
  type PiHarnessEvents,
  type RunId,
  type RuntimeEvent,
  type SessionEvent,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
} from "@piharness/core";
import { definePlugin, type PluginContext } from "@piharness/kernel";

export interface AgentCoreConfig {
  readonly idFactory?: () => string;
}

export class DefaultAgentService implements AgentService {
  constructor(
    readonly sessions: SessionStore,
    readonly contextService: import("@piharness/core").ContextService,
    readonly runtime: import("@piharness/core").AgentRuntime,
    readonly emit: PluginContext<PiHarnessEvents>["emit"],
    readonly idFactory: () => string = randomUUID,
    readonly compaction: CompactionService | undefined = undefined,
  ) {}

  async fork(request: AgentForkRequest): Promise<SessionSnapshot> {
    const targetId = request.targetSessionId
      ?? asSessionId(`session-${this.idFactory()}`);
    return this.sessions.fork({
      sourceId: request.sourceSessionId,
      targetId,
      ...(request.throughVersion === undefined
        ? {}
        : { throughVersion: request.throughVersion }),
    });
  }

  async prompt(request: AgentPromptRequest): Promise<AgentExecution> {
    const sessionId = request.sessionId ?? asSessionId(`session-${this.idFactory()}`);
    let session = await this.sessions.read(sessionId);
    if (session === undefined) {
      session = await this.sessions.create({ id: sessionId, cwd: request.cwd });
    }

    const recoveryEvents = interruptedRunRecoveryEvents(session, this.idFactory);
    if (recoveryEvents.length > 0) {
      session = await this.sessions.append({
        id: sessionId,
        expectedVersion: session.version,
        events: recoveryEvents,
      });
      await this.emit("session.appended", {
        sessionId,
        events: session.events.slice(-recoveryEvents.length),
      });
    }

    let history = deriveSessionMessages(session);
    if (this.compaction !== undefined) {
      const compacted = await this.compaction.compact({
        sessionId,
        messages: history,
        signal: request.signal ?? new AbortController().signal,
      });
      if (compacted !== undefined) {
        const event: SessionEvent = {
          type: "context.compacted",
          payload: {
            summaryMessage: compacted.summaryMessage,
            sourceMessageCount: history.length,
            retainedMessageCount: compacted.retainedMessages.length,
          },
        };
        session = await this.sessions.append({
          id: sessionId,
          expectedVersion: session.version,
          events: [event],
        });
        await this.emit("session.appended", {
          sessionId,
          events: session.events.slice(-1),
        });
        history = [compacted.summaryMessage, ...compacted.retainedMessages];
      }
    }
    const prepared = await this.contextService.prepare({
      sessionId,
      cwd: request.cwd,
      prompt: request.prompt,
      history,
      signal: request.signal ?? new AbortController().signal,
    });
    assertAdditionsAreVisible(prepared.messages, prepared.additions);

    const runId = asRunId(`run-${this.idFactory()}`);
    const startEvents: SessionEvent[] = [
      ...prepared.additions.map((message): SessionEvent => ({
        type: "message.appended",
        payload: { messageId: messageId(`message-${this.idFactory()}`), message },
      })),
      { type: "run.started", payload: { runId, model: request.model } },
    ];
    session = await this.sessions.append({
      id: sessionId,
      expectedVersion: session.version,
      events: startEvents,
    });
    await this.emit("session.appended", {
      sessionId,
      events: session.events.slice(-startEvents.length),
    });

    const runtimeRun = this.runtime.start({
      runId,
      sessionId,
      cwd: request.cwd,
      model: request.model,
      ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
      systemPrompt: prepared.systemPrompt,
      messages: prepared.messages,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return new PersistedExecution(
      sessionId,
      runId,
      runtimeRun,
      this.sessions,
      session.version,
      prepared.messages.length,
      this.idFactory,
      this.emit,
    );
  }
}

class PersistedExecution implements AgentExecution {
  readonly result: Promise<AgentExecutionResult>;
  #version: number;
  #currentTurnId: import("@piharness/core").TurnId | undefined;
  readonly #pendingToolCalls: import("@piharness/core").ToolCall[] = [];
  #persistedGeneratedMessages = 0;
  readonly #unsubscribe: () => void;

  constructor(
    readonly sessionId: SessionId,
    readonly runId: RunId,
    readonly runtimeRun: AgentRun,
    readonly sessions: SessionStore,
    version: number,
    readonly inputMessageCount: number,
    readonly idFactory: () => string,
    readonly emit: PluginContext<PiHarnessEvents>["emit"],
  ) {
    this.#version = version;
    this.#unsubscribe = runtimeRun.subscribe((event) => this.#onRuntimeEvent(event));
    this.result = this.#complete(runtimeRun.result);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    yield* this.runtimeRun;
  }

  abort(reason?: unknown): void { this.runtimeRun.abort(reason); }
  steer(message: AgentMessage): void { this.runtimeRun.steer(message); }
  followUp(message: AgentMessage): void { this.runtimeRun.followUp(message); }

  async #onRuntimeEvent(event: RuntimeEvent): Promise<void> {
    await this.emit("runtime.event", { sessionId: this.sessionId, event });
    switch (event.type) {
      case "turn_start": {
        this.#currentTurnId = asTurnId(`turn-${this.idFactory()}`);
        await this.#append([{
          type: "turn.started",
          payload: { runId: this.runId, turnId: this.#currentTurnId },
        }]);
        break;
      }
      case "user_message":
        await this.#appendMessage(event.message);
        break;
      case "tool_call":
        this.#pendingToolCalls.push(event.call);
        break;
      case "assistant_message": {
        const turnId = this.#requireTurn();
        const events: SessionEvent[] = [{
          type: "message.appended",
          payload: {
            messageId: messageId(`message-${this.idFactory()}`),
            runId: this.runId,
            turnId,
            message: event.message,
          },
        }];
        for (const call of this.#pendingToolCalls.splice(0)) {
          events.push({
            type: "tool.started",
            payload: {
              runId: this.runId,
              turnId,
              callId: call.id,
              name: call.name,
              input: call.arguments,
            },
          });
        }
        await this.#append(events);
        this.#persistedGeneratedMessages += 1;
        break;
      }
      case "tool_result": {
        const turnId = this.#requireTurn();
        await this.#append([
          {
            type: "tool.completed",
            payload: {
              runId: this.runId,
              turnId,
              callId: event.callId,
              name: event.name,
              result: event.result,
            },
          },
          {
            type: "message.appended",
            payload: {
              messageId: messageId(`message-${this.idFactory()}`),
              runId: this.runId,
              turnId,
              message: {
                role: "tool",
                callId: event.callId,
                name: event.name,
                content: event.result.content,
                isError: event.result.isError ?? false,
              },
            },
          },
        ]);
        this.#persistedGeneratedMessages += 1;
        break;
      }
      case "turn_end": {
        const turnId = this.#requireTurn();
        await this.#append([{
          type: "turn.completed",
          payload: {
            runId: this.runId,
            turnId,
            ...(event.usage === undefined ? {} : { usage: event.usage }),
          },
        }]);
        this.#currentTurnId = undefined;
        break;
      }
    }
  }

  async #appendMessage(message: AgentMessage): Promise<void> {
    await this.#append([{
      type: "message.appended",
      payload: {
        messageId: messageId(`message-${this.idFactory()}`),
        runId: this.runId,
        message,
      },
    }]);
    this.#persistedGeneratedMessages += 1;
  }

  async #append(events: readonly SessionEvent[]): Promise<SessionSnapshot> {
    if (events.length === 0) {
      const current = await this.sessions.read(this.sessionId);
      if (current === undefined) throw new Error(`Session disappeared: ${this.sessionId}`);
      return current;
    }
    const session = await this.sessions.append({
      id: this.sessionId,
      expectedVersion: this.#version,
      events,
    });
    this.#version = session.version;
    await this.emit("session.appended", {
      sessionId: this.sessionId,
      events: session.events.slice(-events.length),
    });
    return session;
  }

  async #complete(runtimeResult: Promise<import("@piharness/core").RuntimeResult>): Promise<AgentExecutionResult> {
    const runtime = await runtimeResult;
    this.#unsubscribe();
    const unpersisted = runtime.messages.slice(
      this.inputMessageCount + this.#persistedGeneratedMessages,
    );
    const completionEvents: SessionEvent[] = [
      ...unpersisted.map((message): SessionEvent => ({
        type: "message.appended",
        payload: {
          messageId: messageId(`message-${this.idFactory()}`),
          runId: this.runId,
          message,
        },
      })),
      {
        type: "run.completed",
        payload: {
          runId: this.runId,
          outcome: runtime.stopReason === "error"
            ? "failed"
            : runtime.stopReason === "aborted" ? "aborted" : "completed",
          ...(runtime.errorMessage === undefined ? {} : { error: runtime.errorMessage }),
        },
      },
    ];
    const session = await this.#append(completionEvents);
    return { session, runtime };
  }

  #requireTurn(): import("@piharness/core").TurnId {
    if (this.#currentTurnId === undefined) {
      throw new Error(`Runtime event requires an active turn for run ${this.runId}`);
    }
    return this.#currentTurnId;
  }
}

export const agentCorePlugin = definePlugin<AgentCoreConfig, PiHarnessEvents>({
  name: "agent-core",
  provides: [agentServiceToken],
  requires: [sessionStoreToken, contextServiceToken, runtimeToken],
  optional: [compactionServiceToken],
  setup(context, config) {
    context.provide(agentServiceToken, new DefaultAgentService(
      context.use(sessionStoreToken),
      context.use(contextServiceToken),
      context.use(runtimeToken),
      context.emit,
      config.idFactory,
      context.has(compactionServiceToken) ? context.use(compactionServiceToken) : undefined,
    ));
  },
});

function assertAdditionsAreVisible(
  messages: readonly AgentMessage[],
  additions: readonly AgentMessage[],
): void {
  if (additions.length === 0 || additions.length > messages.length) {
    throw new Error("Prepared context must declare at least one visible addition");
  }
  const suffix = messages.slice(-additions.length);
  if (suffix.some((message, index) => !isDeepStrictEqual(message, additions[index]))) {
    throw new Error("Prepared context additions must be the exact message suffix");
  }
}

function interruptedRunRecoveryEvents(
  session: SessionSnapshot,
  idFactory: () => string,
): SessionEvent[] {
  const activeRuns = new Map<RunId, true>();
  const pendingTools = new Map<
    string,
    {
      runId: RunId;
      turnId: import("@piharness/core").TurnId;
      callId: import("@piharness/core").ToolCallId;
      name: string;
    }
  >();

  for (const stored of session.events) {
    const event = stored.event;
    if (event.type === "run.started") {
      activeRuns.set(event.payload.runId, true);
    } else if (event.type === "run.completed") {
      activeRuns.delete(event.payload.runId);
      for (const [callId, tool] of pendingTools) {
        if (tool.runId === event.payload.runId) pendingTools.delete(callId);
      }
    } else if (event.type === "tool.started") {
      pendingTools.set(event.payload.callId, event.payload);
    } else if (event.type === "tool.completed") {
      pendingTools.delete(event.payload.callId);
    }
  }

  const events: SessionEvent[] = [];
  for (const runId of activeRuns.keys()) {
    for (const tool of pendingTools.values()) {
      if (tool.runId !== runId) continue;
      const result = {
        content: [text("Tool execution was interrupted. It was not replayed automatically.")],
        details: { recovered: true },
        isError: true,
      };
      events.push(
        {
          type: "tool.completed",
          payload: {
            runId,
            turnId: tool.turnId,
            callId: tool.callId,
            name: tool.name,
            result,
          },
        },
        {
          type: "message.appended",
          payload: {
            messageId: messageId(`message-${idFactory()}`),
            runId,
            turnId: tool.turnId,
            message: {
              role: "tool",
              callId: tool.callId,
              name: tool.name,
              content: result.content,
              isError: true,
            },
          },
        },
      );
    }
    events.push({
      type: "run.completed",
      payload: {
        runId,
        outcome: "failed",
        error: "Recovered an interrupted run; pending tools were not replayed",
      },
    });
  }
  return events;
}
