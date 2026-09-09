import { randomUUID } from "node:crypto";
import {
  agentServiceToken,
  agentPresetServiceToken,
  compactionServiceToken,
  contextServiceToken,
  deriveSessionMessages,
  foldSessionSurface,
  foldSessionInbox,
  interruptedSessionClosers,
  messageId,
  runId as asRunId,
  runtimeToken,
  sessionInitializerToken,
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
  type SealHarnessEvents,
  type RunId,
  type RuntimeEvent,
  type JsonObject,
  type SessionEvent,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type SessionInitializer,
  type AgentPresetService,
  SessionConflictError,
} from "@seal-harness/core";
import { definePlugin, type PluginContext } from "@seal-harness/kernel";

export interface AgentCoreConfig {
  readonly idFactory?: () => string;
}

export class DefaultAgentService implements AgentService {
  readonly #active = new Map<SessionId, AgentExecution>();
  constructor(
    readonly sessions: SessionStore,
    readonly contextService: import("@seal-harness/core").ContextService,
    readonly runtime: import("@seal-harness/core").AgentRuntime,
    readonly emit: PluginContext<SealHarnessEvents>["emit"],
    readonly idFactory: () => string = randomUUID,
    readonly compaction: CompactionService | undefined = undefined,
    readonly initializer: SessionInitializer | undefined = undefined,
    readonly agentPresets: AgentPresetService | undefined = undefined,
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
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    });
  }

  active(sessionId: SessionId): AgentExecution | undefined { return this.#active.get(sessionId); }

  async prompt(request: AgentPromptRequest): Promise<AgentExecution> {
    const sessionId = request.sessionId ?? asSessionId(`session-${this.idFactory()}`);
    let session = await this.sessions.read(sessionId);
    if (session === undefined) {
      session = await this.sessions.create({
        id: sessionId,
        cwd: request.cwd,
        ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
      });
    }
    if (request.agentPreset !== undefined && this.agentPresets !== undefined) { await this.agentPresets.set(session.id, request.agentPreset); session = await this.sessions.read(session.id) ?? session; }
    if (this.initializer !== undefined) session = await this.initializer.initialize(session);
    if (this.agentPresets !== undefined) session = await this.agentPresets.initialize(session);

    const recoveryEvents = interruptedSessionClosers(session);
    if (recoveryEvents.length > 0) {
      session = await this.sessions.append({
        id: sessionId,
        expectedVersion: session.version,
        events: recoveryEvents,
      });
    }

    if ((request.injectedMessages?.length ?? 0) > 0) {
      session = await this.sessions.append({
        id: sessionId,
        expectedVersion: session.version,
        events: request.injectedMessages!.map((message): SessionEvent => ({
          type: "message.appended",
          payload: { messageId: message.id ?? messageId(`message-${this.idFactory()}`), message },
        })),
      });
    }

    let history = deriveSessionMessages(session);
    if (this.compaction !== undefined) {
      const compacted = await this.compaction.compact({
        sessionId,
        messages: history,
        model: request.model,
        signal: request.signal ?? new AbortController().signal,
      });
      if (compacted !== undefined) {
        const surface = foldSessionSurface(session.events);
        const shadowed = compacted.retainedMessages.length === 0 ? surface.nodes : surface.nodes.slice(0, -compacted.retainedMessages.length);
        const event: SessionEvent = {
          type: "context.compacted",
          payload: {
            summaryMessage: compacted.summaryMessage,
            sourceMessageCount: history.length,
            retainedMessageCount: compacted.retainedMessages.length,
          },
          ...(shadowed.length === 0 ? { surfaceOp: "append" as const } : {
            surfaceOp: { op: "replace" as const, start: shadowed[0]!, end: shadowed.at(-1)! },
            sourceEventSeqs: shadowed,
          }),
        };
        session = await this.sessions.append({
          id: sessionId,
          expectedVersion: session.version,
          events: [event],
        });
        history = [compacted.summaryMessage, ...compacted.retainedMessages];
      }
    }
    const prepared = await this.contextService.prepare({
      sessionId,
      cwd: request.cwd,
      prompt: request.prompt,
      ...(request.promptMessageId === undefined ? {} : { promptMessageId: request.promptMessageId }),
      ...(request.promptSource === undefined ? {} : { promptSource: request.promptSource }),
      history,
      signal: request.signal ?? new AbortController().signal,
    });
    assertAdditionsAreVisible(prepared.messages, prepared.additions);
    // Context contributors may durably checkpoint policy/projection state (the
    // DSH permission, sandbox, and approval layers do this on first assembly).
    // Rejoin the authoritative append cursor before opening the run.
    session = await this.sessions.read(sessionId) ?? session;

    const runId = asRunId(`run-${this.idFactory()}`);
    const restoredInbox = foldSessionInbox(session.events);
    const startEvents: SessionEvent[] = [
      ...(request.preludeEvents ?? []),
      ...prepared.additions.map((message): SessionEvent => ({
        type: "message.appended",
        payload: { messageId: message.role === "user" && message.id !== undefined ? message.id : messageId(`message-${this.idFactory()}`), message },
      })),
      { type: "run.started", payload: { runId, model: request.model, ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }), ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }) } },
    ];
    for (let attempts = 0; ; attempts += 1) {
      try {
        session = await this.sessions.append({ id: sessionId, expectedVersion: session.version, events: startEvents });
        break;
      } catch (error) {
        if (!(error instanceof SessionConflictError) || attempts >= 15) throw error;
        const current = await this.sessions.read(sessionId);
        if (current === undefined) throw new Error(`Session disappeared: ${sessionId}`);
        session = current;
      }
    }

    const runtimeRun = this.runtime.start({
      runId,
      sessionId,
      cwd: request.cwd,
      model: request.model,
      ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      systemPrompt: prepared.systemPrompt,
      messages: prepared.messages,
      pendingMessages: [
        ...restoredInbox.nextTurn.map((message) => ({ id: message.id!, placement: "queued" as const, message })),
        ...restoredInbox.nextStep.map((message) => ({ id: message.id!, placement: "steering" as const, message })),
      ],
      initialStepMessages: [
        ...(request.injectedMessages ?? []),
        ...prepared.additions.filter((message): message is import("@seal-harness/core").UserMessage => message.role === "user"),
      ],
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.runtimeHooks === undefined ? {} : { hooks: request.runtimeHooks }),
    });
    const execution = new PersistedExecution(
      sessionId,
      runId,
      runtimeRun,
      this.sessions,
      session.version,
      prepared.messages.length,
      this.idFactory,
      this.emit,
    );
    this.#active.set(sessionId, execution);
    void execution.result.then(
      () => { if (this.#active.get(sessionId) === execution) this.#active.delete(sessionId); },
      () => { if (this.#active.get(sessionId) === execution) this.#active.delete(sessionId); },
    );
    return execution;
  }
}

class PersistedExecution implements AgentExecution {
  readonly result: Promise<AgentExecutionResult>;
  #version: number;
  #currentTurnId: import("@seal-harness/core").TurnId | undefined;
  #currentStep: number | undefined;
  #nextStep = 0;
  #nextBlock = 0;
  #streamBlock: { kind: "text" | "reasoning"; index: number; text: string } | undefined;
  readonly #chunkSequences: number[] = [];
  readonly #pendingToolCalls: import("@seal-harness/core").ToolCall[] = [];
  readonly #durableQueuedMessages = new Map<import("@seal-harness/core").MessageId, import("@seal-harness/core").UserMessage>();
  #persistedGeneratedMessages = 0;
  #inputMessageAdjustment = 0;
  readonly #unsubscribe: () => void;

  constructor(
    readonly sessionId: SessionId,
    readonly runId: RunId,
    readonly runtimeRun: AgentRun,
    readonly sessions: SessionStore,
    version: number,
    readonly inputMessageCount: number,
    readonly idFactory: () => string,
    readonly emit: PluginContext<SealHarnessEvents>["emit"],
  ) {
    this.#version = version;
    this.#unsubscribe = runtimeRun.subscribe((event) => this.#onRuntimeEvent(event));
    this.result = this.#complete(runtimeRun.result);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    yield* this.runtimeRun;
  }

  abort(reason?: unknown): void { this.runtimeRun.abort(reason); }
  steer(message: AgentMessage, runtimeMessage: AgentMessage = message): void { this.#rememberDurable(message, runtimeMessage); this.runtimeRun.steer(runtimeMessage); }
  followUp(message: AgentMessage, runtimeMessage: AgentMessage = message): void { this.#rememberDurable(message, runtimeMessage); this.runtimeRun.followUp(runtimeMessage); }
  pendingMessages(): readonly import("@seal-harness/core").PendingAgentMessage[] { return (this.runtimeRun.pendingMessages?.() ?? []).map((entry) => ({ ...entry, message: this.#durableQueuedMessages.get(entry.id) ?? entry.message })); }
  updatePendingMessage(id: import("@seal-harness/core").MessageId, action: import("@seal-harness/core").PendingMessageAction): import("@seal-harness/core").PendingMessageUpdate {
    const result = this.runtimeRun.updatePendingMessage?.(id, action) ?? "not-found";
    if (result === "updated") {
      if (action.kind === "remove") this.#durableQueuedMessages.delete(id);
      else if (action.kind === "edit") {
        const durable = this.#durableQueuedMessages.get(id); if (durable !== undefined) this.#durableQueuedMessages.set(id, { ...durable, content: action.content });
      }
    }
    return result;
  }
  splicePending(placement: import("@seal-harness/core").PendingAgentMessage["placement"], start: number, deleteCount: number, inserted: readonly import("@seal-harness/core").UserMessage[]): readonly import("@seal-harness/core").UserMessage[] {
    return this.runtimeRun.splicePending?.(placement, start, deleteCount, inserted) ?? [];
  }
  subscribePending(listener: (messages: readonly import("@seal-harness/core").PendingAgentMessage[]) => void): () => void { return this.runtimeRun.subscribePending?.((messages) => listener(messages.map((entry) => ({ ...entry, message: this.#durableQueuedMessages.get(entry.id) ?? entry.message })))) ?? (() => {}); }

  async #onRuntimeEvent(event: RuntimeEvent): Promise<void> {
    await this.emit("runtime.event", { sessionId: this.sessionId, event });
    switch (event.type) {
      case "turn_start": {
        this.#currentTurnId = asTurnId(`turn-${this.idFactory()}`);
        this.#currentStep = undefined;
        this.#nextStep = 0;
        await this.#append([{
          type: "turn.started",
          payload: { runId: this.runId, turnId: this.#currentTurnId },
        }]);
        break;
      }
      case "user_message":
        await this.#appendMessage(this.#durableMessage(event.message));
        break;
      case "pre_step": {
        const turnId = this.#requireTurn();
        const boundaries: SessionEvent[] = this.#currentStep === undefined ? [] : [{ type: "step.completed", payload: { runId: this.runId, turnId, step: this.#currentStep } }];
        this.#currentStep = undefined;
        if (!event.rejected) {
          this.#currentStep = this.#nextStep++;
          this.#nextBlock = 0;
          this.#streamBlock = undefined;
          this.#chunkSequences.splice(0);
          boundaries.push({ type: "step.started", payload: { runId: this.runId, turnId, step: this.#currentStep } });
        }
        await this.#append(boundaries);
        this.#inputMessageAdjustment += event.messages.length - event.original.length;
        if (event.original.length === 0) {
          await this.#append(event.messages.map((message): SessionEvent => ({ type: "message.appended", payload: { messageId: message.id ?? messageId(`message-${this.idFactory()}`), runId: this.runId, message } })));
          break;
        }
        const current = await this.sessions.read(this.sessionId);
        if (current === undefined) throw new Error(`Session disappeared: ${this.sessionId}`);
        const bySequence = new Map(current.events.map((entry) => [entry.sequence, entry.event]));
        const userNodes = foldSessionSurface(current.events).nodes.filter((sequence) => bySequence.get(sequence)?.type === "message.appended" && (bySequence.get(sequence) as Extract<SessionEvent, { type: "message.appended" }>).payload.message.role === "user");
        const originalIds = new Set(event.original.map((message) => message.id).filter((id) => id !== undefined));
        let sources = originalIds.size === event.original.length
          ? userNodes.filter((sequence) => { const stored = bySequence.get(sequence); return stored?.type === "message.appended" && stored.payload.message.role === "user" && stored.payload.message.id !== undefined && originalIds.has(stored.payload.message.id); }).slice(-event.original.length)
          : userNodes.slice(-event.original.length);
        if (sources.length !== event.original.length) sources = userNodes.slice(-event.original.length);
        if (sources.length !== event.original.length) throw new Error("pre-step input is not present on the current Session surface");
        const replacement: SessionEvent[] = event.messages.length === 0 ? [{ type: "surface.removed", payload: {}, surfaceOp: { op: "replace", start: sources[0]!, end: sources.at(-1)! }, sourceEventSeqs: sources }] : event.messages.map((message, index): SessionEvent => ({
          type: "message.appended",
          payload: { messageId: message.id ?? messageId(`message-${this.idFactory()}`), runId: this.runId, message },
          ...(index === 0 ? { surfaceOp: { op: "replace" as const, start: sources[0]!, end: sources.at(-1)! }, sourceEventSeqs: sources } : {}),
        }));
        await this.#append(replacement);
        break;
      }
      case "text_delta":
      case "reasoning_delta": {
        const kind = event.type === "text_delta" ? "text" : "reasoning";
        const chunks: JsonObject[] = [];
        if (this.#streamBlock?.kind !== kind) {
          if (this.#streamBlock !== undefined) chunks.push({ type: "block-end", index: this.#streamBlock.index, block: { type: this.#streamBlock.kind, text: this.#streamBlock.text } });
          this.#streamBlock = { kind, index: this.#nextBlock++, text: "" };
          chunks.push({ type: "block-start", index: this.#streamBlock.index, blockType: kind });
        }
        this.#streamBlock.text += event.delta;
        chunks.push({ type: kind === "text" ? "text-delta" : "reasoning-delta", index: this.#streamBlock.index, text: event.delta });
        await this.#appendChunks(chunks);
        break;
      }
      case "request_header":
        await this.#append([
          { type: "request.header", payload: { header: event.header, reason: event.reason, ...(event.startsSeries === undefined ? {} : { startsSeries: event.startsSeries }) } },
          { type: "request.context", payload: { provider: event.header.config.provider, model: event.header.config.model } },
        ]);
        break;
      case "tool_call":
        if (this.#streamBlock !== undefined) {
          await this.#appendChunks([{ type: "block-end", index: this.#streamBlock.index, block: { type: this.#streamBlock.kind, text: this.#streamBlock.text } }]);
          this.#streamBlock = undefined;
        }
        {
          const index = this.#nextBlock++;
          const argumentsValue = typeof event.call.providerData?.dshArguments === "string" ? event.call.providerData.dshArguments : JSON.stringify(event.call.arguments);
          await this.#appendChunks([
            { type: "block-start", index, blockType: "tool-call" },
            { type: "tool-call-delta", index, id: event.call.id, name: event.call.name, argumentsDelta: argumentsValue },
            { type: "block-end", index, block: { type: "tool-call", id: event.call.id, name: event.call.name, arguments: argumentsValue } },
          ]);
        }
        this.#pendingToolCalls.push(event.call);
        break;
      case "assistant_message": {
        const turnId = this.#requireTurn();
        const terminalChunks: JsonObject[] = [];
        if (this.#streamBlock !== undefined) {
          terminalChunks.push({ type: "block-end", index: this.#streamBlock.index, block: { type: this.#streamBlock.kind, text: this.#streamBlock.text } });
          this.#streamBlock = undefined;
        }
        if (event.usage !== undefined) terminalChunks.push({ type: "usage", usage: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens ?? event.usage.inputTokens + event.usage.outputTokens + (event.usage.cacheReadTokens ?? 0) + (event.usage.cacheWriteTokens ?? 0), ...(event.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: event.usage.cacheReadTokens }), ...(event.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: event.usage.cacheWriteTokens }), ...(event.usage.reasoningTokens === undefined ? {} : { reasoningTokens: event.usage.reasoningTokens }) } });
        const finishKind = event.stopReason === "tool_call" ? "tool-calls" : event.stopReason === "length" ? "max-tokens" : event.stopReason === "aborted" ? "aborted" : event.stopReason === "error" ? "error" : "stop";
        terminalChunks.push({ type: "finish", reason: finishKind === "aborted" || finishKind === "error" ? { kind: finishKind, failure: { message: `Seal model request ${finishKind}`, code: "UNKNOWN" } } : { kind: finishKind }, ...(event.message.replayState === undefined ? {} : { replayState: { response: event.message.replayState.response, ...(event.message.replayState.blocks === undefined ? {} : { blocks: event.message.replayState.blocks }) } }) });
        await this.#appendChunks(terminalChunks);
        const imported: import("@seal-harness/core").AssistantMessage = event.usage === undefined && event.interrupted !== true ? event.message : {
          ...event.message,
          providerData: {
            ...(event.message.providerData ?? {}),
            dsh: {
              ...((event.message.providerData?.dsh as JsonObject | undefined) ?? {}),
              ...(event.usage === undefined ? {} : { usage: {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                ...(event.usage.totalTokens === undefined ? {} : { totalTokens: event.usage.totalTokens }),
                ...(event.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: event.usage.cacheReadTokens }),
                ...(event.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: event.usage.cacheWriteTokens }),
                ...(event.usage.reasoningTokens === undefined ? {} : { reasoningTokens: event.usage.reasoningTokens }),
              } }),
              ...(event.interrupted === true ? { interrupted: true } : {}),
            },
          },
        };
        const events: SessionEvent[] = [{
          type: "message.appended",
          payload: {
            messageId: messageId(`message-${this.idFactory()}`),
            runId: this.runId,
            turnId,
            message: imported,
          },
          ...(this.#chunkSequences.length === 0 ? {} : { sourceEventSeqs: [...this.#chunkSequences] }),
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
        this.#chunkSequences.splice(0);
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
      case "tool_dispatch": {
        const dispatch = event.event;
        await this.#append([dispatch.type === "start" ? {
          type: "tool/code-dispatch-start",
          payload: {
            rootCallId: dispatch.rootCallId,
            parentCallId: dispatch.parentCallId,
            subCallId: dispatch.subCallId,
            name: dispatch.name,
            arguments: dispatch.arguments,
          },
        } : {
          type: "tool/code-dispatch",
          payload: {
            rootCallId: dispatch.rootCallId,
            parentCallId: dispatch.parentCallId,
            subCallId: dispatch.subCallId,
            name: dispatch.name,
            arguments: dispatch.arguments,
            isError: dispatch.result.isError === true,
            content: dispatch.result.content,
          },
        }]);
        break;
      }
      case "inbox_spliced":
        await this.#append([{ type: "agent/inbox.spliced", payload: { target: event.target, start: event.start, inserted: event.inserted, ...(event.removedCount === undefined ? {} : { removedCount: event.removedCount }), ...(event.outcome === undefined ? {} : { outcome: event.outcome }) } }]);
        break;
      case "turn_end": {
        const turnId = this.#requireTurn();
        await this.#append([
          ...(this.#currentStep === undefined ? [] : [{ type: "step.completed" as const, payload: { runId: this.runId, turnId, step: this.#currentStep } }]),
          {
          type: "turn.completed",
          payload: {
            runId: this.runId,
            turnId,
            ...(event.usage === undefined ? {} : { usage: event.usage }),
            ...(event.firstTokenAt === undefined ? {} : { timing: { firstTokenAt: event.firstTokenAt } }),
            ...(event.stopReason === undefined ? {} : { stopReason: event.stopReason }),
          },
          },
        ]);
        this.#currentStep = undefined;
        this.#currentTurnId = undefined;
        break;
      }
    }
  }

  async #appendMessage(message: AgentMessage): Promise<void> {
    await this.#append([{
      type: "message.appended",
      payload: {
        messageId: message.role === "user" && message.id !== undefined ? message.id : messageId(`message-${this.idFactory()}`),
        runId: this.runId,
        message,
      },
    }]);
    this.#persistedGeneratedMessages += 1;
  }

  async #appendChunks(chunks: readonly JsonObject[]): Promise<void> {
    if (chunks.length === 0 || this.#currentStep === undefined) return;
    const turnId = this.#requireTurn();
    await this.#append(chunks.map((chunk): SessionEvent => ({ type: "assistant.chunk", payload: { runId: this.runId, turnId, step: this.#currentStep!, chunk } })));
    for (let sequence = this.#version - chunks.length + 1; sequence <= this.#version; sequence += 1) this.#chunkSequences.push(sequence);
  }

  async #append(events: readonly SessionEvent[]): Promise<SessionSnapshot> {
    if (events.length === 0) {
      const current = await this.sessions.read(this.sessionId);
      if (current === undefined) throw new Error(`Session disappeared: ${this.sessionId}`);
      return current;
    }
    let session: SessionSnapshot | undefined;
    let expectedVersion = this.#version;
    for (let attempts = 0; session === undefined; attempts += 1) {
      try {
        session = await this.sessions.append({ id: this.sessionId, expectedVersion, events });
      } catch (error) {
        if (!(error instanceof SessionConflictError) || attempts >= 15) throw error;
        const current = await this.sessions.read(this.sessionId);
        if (current === undefined) throw new Error(`Session disappeared: ${this.sessionId}`);
        expectedVersion = current.version;
      }
    }
    this.#version = session.version;
    return session;
  }

  async #complete(runtimeResult: Promise<import("@seal-harness/core").RuntimeResult>): Promise<AgentExecutionResult> {
    const runtime = await runtimeResult;
    this.#unsubscribe();
    const unpersisted = runtime.messages.slice(
      this.inputMessageCount + this.#inputMessageAdjustment + this.#persistedGeneratedMessages,
    );
    const completionEvents: SessionEvent[] = [
      ...unpersisted.map((runtimeMessage): SessionEvent => {
        const message = this.#durableMessage(runtimeMessage);
        return ({
        type: "message.appended",
        payload: {
          messageId: message.role === "user" && message.id !== undefined ? message.id : messageId(`message-${this.idFactory()}`),
          runId: this.runId,
          message,
        },
      }); }),
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

  #rememberDurable(message: AgentMessage, runtimeMessage: AgentMessage): void {
    if (message.role === "user" && message.id !== undefined && runtimeMessage !== message) this.#durableQueuedMessages.set(message.id, message);
  }

  #durableMessage(message: AgentMessage): AgentMessage {
    if (message.role !== "user" || message.id === undefined) return message;
    const durable = this.#durableQueuedMessages.get(message.id);
    if (durable === undefined) return message;
    this.#durableQueuedMessages.delete(message.id);
    return durable;
  }

  #requireTurn(): import("@seal-harness/core").TurnId {
    if (this.#currentTurnId === undefined) {
      throw new Error(`Runtime event requires an active turn for run ${this.runId}`);
    }
    return this.#currentTurnId;
  }
}

export const agentCorePlugin = definePlugin<AgentCoreConfig, SealHarnessEvents>({
  name: "agent-core",
  provides: [agentServiceToken],
  requires: [sessionStoreToken, contextServiceToken, runtimeToken],
  optional: [compactionServiceToken, sessionInitializerToken, agentPresetServiceToken],
  setup(context, config) {
    context.provide(agentServiceToken, new DefaultAgentService(
      context.use(sessionStoreToken),
      context.use(contextServiceToken),
      context.use(runtimeToken),
      context.emit,
      config.idFactory,
      context.has(compactionServiceToken) ? context.use(compactionServiceToken) : undefined,
      context.has(sessionInitializerToken) ? context.use(sessionInitializerToken) : undefined,
      context.has(agentPresetServiceToken) ? context.use(agentPresetServiceToken) : undefined,
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
  if (suffix.some((message, index) => message.role !== additions[index]?.role)) {
    throw new Error("Prepared context additions must correspond to the projected message suffix");
  }
}
