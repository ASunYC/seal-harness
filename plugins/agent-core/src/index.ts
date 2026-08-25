import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  agentServiceToken,
  contextServiceToken,
  messageId,
  runId as asRunId,
  runtimeToken,
  sessionId as asSessionId,
  sessionStoreToken,
  type AgentExecution,
  type AgentExecutionResult,
  type AgentMessage,
  type AgentPromptRequest,
  type AgentRun,
  type AgentService,
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
  ) {}

  async prompt(request: AgentPromptRequest): Promise<AgentExecution> {
    const sessionId = request.sessionId ?? asSessionId(`session-${this.idFactory()}`);
    let session = await this.sessions.read(sessionId);
    if (session === undefined) {
      session = await this.sessions.create({ id: sessionId, cwd: request.cwd });
    }

    const history = messagesFrom(session);
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

  constructor(
    readonly sessionId: SessionId,
    readonly runId: RunId,
    readonly runtimeRun: AgentRun,
    sessions: SessionStore,
    version: number,
    inputMessageCount: number,
    idFactory: () => string,
    readonly emit: PluginContext<PiHarnessEvents>["emit"],
  ) {
    this.result = runtimeRun.result.then(async (runtime) => {
      const generatedMessages = runtime.messages.slice(inputMessageCount);
      const completionEvents: SessionEvent[] = [
        ...generatedMessages.map((message): SessionEvent => ({
          type: "message.appended",
          payload: {
            messageId: messageId(`message-${idFactory()}`),
            runId,
            message,
          },
        })),
        {
          type: "run.completed",
          payload: {
            runId,
            outcome: runtime.stopReason === "error"
              ? "failed"
              : runtime.stopReason === "aborted" ? "aborted" : "completed",
            ...(runtime.errorMessage === undefined ? {} : { error: runtime.errorMessage }),
          },
        },
      ];
      const session = await sessions.append({
        id: sessionId,
        expectedVersion: version,
        events: completionEvents,
      });
      await emit("session.appended", {
        sessionId,
        events: session.events.slice(-completionEvents.length),
      });
      return { session, runtime };
    });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    for await (const event of this.runtimeRun) {
      await this.emit("runtime.event", { sessionId: this.sessionId, event });
      yield event;
    }
  }

  abort(reason?: unknown): void { this.runtimeRun.abort(reason); }
  steer(message: AgentMessage): void { this.runtimeRun.steer(message); }
  followUp(message: AgentMessage): void { this.runtimeRun.followUp(message); }
}

export const agentCorePlugin = definePlugin<AgentCoreConfig, PiHarnessEvents>({
  name: "agent-core",
  provides: [agentServiceToken],
  requires: [sessionStoreToken, contextServiceToken, runtimeToken],
  setup(context, config) {
    context.provide(agentServiceToken, new DefaultAgentService(
      context.use(sessionStoreToken),
      context.use(contextServiceToken),
      context.use(runtimeToken),
      context.emit,
      config.idFactory,
    ));
  },
});

function messagesFrom(session: SessionSnapshot): AgentMessage[] {
  return session.events.flatMap((stored) =>
    stored.event.type === "message.appended" ? [stored.event.payload.message] : [],
  );
}

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
