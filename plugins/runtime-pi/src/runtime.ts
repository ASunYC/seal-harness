import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import { randomUUID } from "node:crypto";
import type { AssistantMessage as PiAssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type {
  AgentMessage,
  AgentRun,
  AgentRuntime,
  ModelService,
  ModelStopReason,
  ModelUsage,
  PendingAgentMessage,
  PendingMessageAction,
  PendingMessageUpdate,
  RuntimeEvent,
  RuntimeResult,
  RuntimeStartRequest,
  ToolResult,
  ToolService,
} from "@seal-harness/core";
import { messageId, toolCallId } from "@seal-harness/core";
import { Type } from "typebox";
import { AsyncChannel } from "./async-channel.js";
import { createModelBridge, createPiModel, createRejectedStepStream, createRetryableModelBridge } from "./model-bridge.js";
import { fromPiAssistantMessage, fromPiMessages, toPiMessage, toPiMessages } from "./messages.js";

export interface PiRuntimeOptions {
  readonly toolExecution?: "parallel" | "sequential";
  readonly steeringMode?: "all" | "one-at-a-time";
  readonly followUpMode?: "all" | "one-at-a-time";
}

export class PiAgentRuntime implements AgentRuntime {
  constructor(
    readonly modelService: ModelService,
    readonly toolService: ToolService | undefined,
    readonly options: PiRuntimeOptions = {},
  ) {}

  start(request: RuntimeStartRequest): AgentRun {
    return new PiAgentRun(this.modelService, this.toolService, this.options, request);
  }
}

class PiAgentRun implements AgentRun {
  readonly #channel = new AsyncChannel<RuntimeEvent>();
  readonly #abortController = new AbortController();
  readonly #pendingSteering: AgentMessage[] = [];
  readonly #pendingFollowUps: AgentMessage[] = [];
  readonly #listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  readonly #pendingListeners = new Set<(messages: readonly PendingAgentMessage[]) => void>();
  readonly #durableNextTurn: import("@seal-harness/core").UserMessage[] = [];
  readonly #durableNextStep: import("@seal-harness/core").UserMessage[] = [];
  readonly #toolControl = { concludesTurn: false, errors: new Map<string, boolean>() };
  #preStepRejected = false;
  #inboxDurability: Promise<void> = Promise.resolve();
  #agent?: Agent;
  readonly result: Promise<RuntimeResult>;

  constructor(
    modelService: ModelService,
    toolService: ToolService | undefined,
    options: PiRuntimeOptions,
    readonly request: RuntimeStartRequest,
  ) {
    for (const entry of request.pendingMessages ?? []) {
      (entry.placement === "queued" ? this.#pendingFollowUps : this.#pendingSteering).push(entry.message);
      (entry.placement === "queued" ? this.#durableNextTurn : this.#durableNextStep).push(structuredClone(entry.message));
    }
    if (request.signal !== undefined) {
      if (request.signal.aborted) this.#abortController.abort(request.signal.reason);
      else request.signal.addEventListener("abort", () => this.abort(request.signal?.reason), { once: true });
    }
    this.result = this.#execute(modelService, toolService, options);
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return this.#channel[Symbol.asyncIterator]();
  }

  abort(reason?: unknown): void {
    if (!this.#abortController.signal.aborted) this.#abortController.abort(reason);
    this.#agent?.abort();
  }

  steer(message: AgentMessage): void {
    const identified = identifyUserMessage(message);
    const start = this.pendingMessages().filter((entry) => entry.placement === "steering").length;
    if (this.#agent === undefined) this.#pendingSteering.push(identified);
    else this.#agent.steer(toPiMessage(identified, this.#agent.state.model));
    if (identified.role === "user") this.#recordInbox({ target: "next-step", start, inserted: [identified] });
    this.#publishPending();
  }

  followUp(message: AgentMessage): void {
    const identified = identifyUserMessage(message);
    const start = this.pendingMessages().filter((entry) => entry.placement === "queued").length;
    if (this.#agent === undefined) this.#pendingFollowUps.push(identified);
    else this.#agent.followUp(toPiMessage(identified, this.#agent.state.model));
    if (identified.role === "user") this.#recordInbox({ target: "next-turn", start, inserted: [identified] });
    this.#publishPending();
  }

  pendingMessages(): readonly PendingAgentMessage[] {
    if (this.#agent === undefined) return [
      ...pendingCore(this.#pendingFollowUps, "queued"),
      ...pendingCore(this.#pendingSteering, "steering"),
    ];
    const queues = piQueues(this.#agent);
    return [
      ...pendingPi(queues.followUpQueue.messages, "queued"),
      ...pendingPi(queues.steeringQueue.messages, "steering"),
    ];
  }

  updatePendingMessage(id: import("@seal-harness/core").MessageId, action: PendingMessageAction): PendingMessageUpdate {
    const before = this.pendingMessages();
    if (this.#agent === undefined) {
      const result = updateCoreQueue(this.#pendingFollowUps, this.#pendingSteering, id, action);
      if (result === "updated") { this.#recordPendingUpdate(before, id, action); this.#publishPending(); }
      return result;
    }
    const queues = piQueues(this.#agent); const model = this.#agent.state.model;
    const followIndex = piMessageIndex(queues.followUpQueue.messages, id);
    const steeringIndex = piMessageIndex(queues.steeringQueue.messages, id);
    const target = followIndex >= 0 ? { messages: queues.followUpQueue.messages, index: followIndex, placement: "queued" as const } : steeringIndex >= 0 ? { messages: queues.steeringQueue.messages, index: steeringIndex, placement: "steering" as const } : undefined;
    if (target === undefined) return "not-found";
    if (action.kind === "steer" && target.placement !== "queued") return "steer-unavailable";
    const current = target.messages[target.index];
    if (current === undefined) return "not-found";
    if (action.kind === "edit") {
      const core = fromPiMessages([current])[0];
      if (core?.role !== "user") return "not-found";
      target.messages[target.index] = toPiMessage({ ...core, content: action.content }, model);
    } else {
      target.messages.splice(target.index, 1);
      if (action.kind === "steer") this.#agent.steer(current);
    }
    this.#publishPending();
    this.#recordPendingUpdate(before, id, action);
    return "updated";
  }

  splicePending(placement: PendingAgentMessage["placement"], start: number, deleteCount: number, inserted: readonly import("@seal-harness/core").UserMessage[]): readonly import("@seal-harness/core").UserMessage[] {
    const identified = inserted.map((message) => identifyUserMessage(message) as import("@seal-harness/core").UserMessage);
    assertUniquePending(this.pendingMessages(), identified, placement, start, deleteCount);
    if (this.#agent === undefined) {
      const target = placement === "queued" ? this.#pendingFollowUps : this.#pendingSteering;
      const removed = target.splice(start, deleteCount, ...identified);
      const offset = start < 0 ? Math.max(target.length - identified.length + removed.length + start, 0) : Math.min(start, target.length - identified.length + removed.length);
      this.#recordInbox({ target: placement === "queued" ? "next-turn" : "next-step", start: offset, ...(removed.length === 0 ? {} : { removedCount: removed.length, outcome: "canceled" as const }), inserted: identified });
      this.#publishPending();
      return removed.filter((message): message is import("@seal-harness/core").UserMessage => message.role === "user");
    }
    const queues = piQueues(this.#agent);
    const target = placement === "queued" ? queues.followUpQueue.messages : queues.steeringQueue.messages;
    const removed = target.splice(start, deleteCount, ...identified.map((message) => toPiMessage(message, this.#agent!.state.model)));
    const offset = start < 0 ? Math.max(target.length - identified.length + removed.length + start, 0) : Math.min(start, target.length - identified.length + removed.length);
    this.#recordInbox({ target: placement === "queued" ? "next-turn" : "next-step", start: offset, ...(removed.length === 0 ? {} : { removedCount: removed.length, outcome: "canceled" as const }), inserted: identified });
    this.#publishPending();
    return fromPiMessages(removed).filter((message): message is import("@seal-harness/core").UserMessage => message.role === "user");
  }

  subscribePending(listener: (messages: readonly PendingAgentMessage[]) => void): () => void {
    this.#pendingListeners.add(listener);
    return () => this.#pendingListeners.delete(listener);
  }

  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #execute(
    modelService: ModelService,
    toolService: ToolService | undefined,
    options: PiRuntimeOptions,
  ): Promise<RuntimeResult> {
    let messages: readonly AgentMessage[] = this.request.messages;
    let requestStep = 0;
    try {
      if (this.#abortController.signal.aborted) {
        await this.#inboxDurability;
        await this.#publish({ type: "run_end", stopReason: "aborted" });
        return { messages, stopReason: "aborted" };
      }

      const model = await createPiModel(
        modelService,
        this.request.model.provider,
        this.request.model.model,
      );
      let requestConfig: import("@seal-harness/core").RuntimeModelRequestConfig = {
        model: { provider: this.request.model.provider, model: this.request.model.model },
        ...(this.request.reasoning === undefined ? {} : { reasoning: this.request.reasoning }),
        ...(this.request.maxTokens === undefined ? {} : { maxTokens: this.request.maxTokens }),
      };
      let requestHeaderKey: string | undefined;
      let requestHeaderStep = 0;
      let agent!: Agent;
      const initialMessages = toPiMessages(this.request.messages, model);
      let knownMessageCount = Math.max(0, initialMessages.length - (this.request.initialStepMessages?.length ?? 0));
      const tools = toolService === undefined ? [] : createPiTools(toolService, this.request, this.#toolControl, (message) => agent.steer(toPiMessage(message, model)), (event) => this.#publish({ type: "tool_dispatch", event }));
      const requestTools = toolService?.definitions(this.request.sessionId).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) ?? [];
      agent = new Agent({
        initialState: {
          systemPrompt: this.request.systemPrompt,
          model,
          thinkingLevel: this.request.reasoning ?? "off",
          tools,
          messages: initialMessages,
        },
        transformContext: async (messages, signal) => {
          const activeSignal = signal ?? this.#abortController.signal;
          const suffix = messages.slice(knownMessageCount);
          const claimed = fromPiMessages(suffix).filter((message): message is import("@seal-harness/core").UserMessage => message.role === "user");
          const decision = await this.request.hooks?.preStep?.({ turn: 1, step: requestStep + 1, signal: activeSignal, messages: claimed })
            ?? { kind: "enter" as const, messages: claimed };
          activeSignal.throwIfAborted();
          if (this.request.hooks?.preStep !== undefined) await this.#publish({ type: "pre_step", original: claimed, messages: decision.kind === "enter" ? decision.messages : [], rejected: decision.kind === "reject" });
          const applyDecision = (target: typeof messages): void => {
            const indices = target.map((message, index) => ({ message, index })).filter(({ message, index }) => index >= knownMessageCount && message.role === "user").map(({ index }) => index);
            const insertAt = indices[0] ?? target.length;
            for (const index of indices.reverse()) target.splice(index, 1);
            if (decision.kind === "enter") target.splice(insertAt, 0, ...decision.messages.map((message) => toPiMessage(message, agent.state.model)));
          };
          applyDecision(messages);
          if (agent.state.messages !== messages) applyDecision(agent.state.messages);
          if (decision.kind === "reject") this.#preStepRejected = true;
          knownMessageCount = messages.length;
          return messages;
        },
        streamFn: async (activeModel, context, streamOptions) => {
          if (this.#preStepRejected) return createRejectedStepStream(activeModel);
          const signal = streamOptions?.signal ?? this.#abortController.signal;
          const { reasoning: _reasoning, maxTokens: _maxTokens, ...forwardedOptions } = streamOptions ?? {};
          const step = ++requestStep;
          const prepare = async (fallbackModel: Model<any>) => {
            const selected = await this.request.hooks?.request?.({ turn: 1, step, signal, config: requestConfig }) ?? requestConfig;
            signal.throwIfAborted(); requestConfig = selected;
            const header = { config: { provider: selected.model.provider, model: selected.model.model, ...(selected.reasoning === undefined ? {} : { reasoningEffort: selected.reasoning }), ...(selected.maxTokens === undefined ? {} : { maxTokens: selected.maxTokens }) }, ...(this.request.systemPrompt === "" ? {} : { system: this.request.systemPrompt }), ...(requestTools.length === 0 ? {} : { tools: requestTools }) };
            const key = JSON.stringify(header); const startsSeries = requestHeaderStep !== step;
            if (requestHeaderKey === undefined) await this.#publish({ type: "request_header", header, reason: "initial" });
            else if (requestHeaderKey !== key) await this.#publish({ type: "request_header", header, reason: "change", ...(startsSeries ? { startsSeries: true } : {}) });
            else if (startsSeries) await this.#publish({ type: "request_header", header, reason: "series" });
            requestHeaderKey = key; requestHeaderStep = step;
            const selectedModel = selected.model.provider === fallbackModel.provider && selected.model.model === fallbackModel.id
              ? fallbackModel
              : await createPiModel(modelService, selected.model.provider, selected.model.model);
            return { model: selectedModel, options: { ...forwardedOptions, ...(selected.reasoning === undefined || selected.reasoning === "off" ? {} : { reasoning: selected.reasoning }), ...(selected.maxTokens === undefined ? {} : { maxTokens: selected.maxTokens }) } };
          };
          const initial = await prepare(activeModel);
          if (this.request.hooks?.requestError === undefined) return createModelBridge(modelService)(initial.model, context, initial.options);
          return createRetryableModelBridge(modelService, async (failure, provider, retrySignal) => {
            const action = await this.request.hooks!.requestError!({ turn: 1, step, signal: retrySignal, provider, failure });
            retrySignal.throwIfAborted();
            return action === "retry" ? prepare(initial.model) : undefined;
          })(initial.model, context, initial.options);
        },
        sessionId: this.request.sessionId,
        toolExecution: options.toolExecution ?? "parallel",
        steeringMode: options.steeringMode ?? "one-at-a-time",
        followUpMode: options.followUpMode ?? "one-at-a-time",
        afterToolCall: async ({ toolCall }) => {
          const isError = this.#toolControl.errors.get(toolCall.id);
          this.#toolControl.errors.delete(toolCall.id);
          return isError === undefined ? undefined : { isError };
        },
        prepareNextTurnWithContext: async ({ message }) => {
          const hasToolCalls = message.content.some((block) => block.type === "toolCall");
          const stopping = !hasToolCalls || this.#toolControl.concludesTurn;
          if (!this.#preStepRejected && stopping && this.pendingMessages().every((entry) => entry.placement !== "steering")) {
            await this.request.hooks?.turnStopping?.({ turn: 1, signal: this.#abortController.signal });
            this.#abortController.signal.throwIfAborted();
          }
          return undefined;
        },
        shouldStopAfterTurn: () => this.#preStepRejected || (this.#toolControl.concludesTurn && !agent.hasQueuedMessages()),
      });
      this.#agent = agent;
      const unsubscribe = agent.subscribe((event) => this.#handleEvent(event));
      this.#abortController.signal.addEventListener("abort", () => agent.abort(), { once: true });

      for (const message of this.#pendingSteering.splice(0)) agent.steer(toPiMessage(message, model));
      for (const message of this.#pendingFollowUps.splice(0)) agent.followUp(toPiMessage(message, model));
      this.#publishPending();

      await agent.continue();
      unsubscribe();
      messages = fromPiMessages(agent.state.messages);
      if (this.#preStepRejected && messages.at(-1)?.role === "assistant" && messages.at(-1)?.content.length === 0) messages = messages.slice(0, -1);
      const lastAssistant = [...agent.state.messages].reverse().find(
        (message): message is PiAssistantMessage => message.role === "assistant",
      );
      const stopReason = lastAssistant === undefined
        ? (this.#abortController.signal.aborted ? "aborted" : "stop")
        : fromPiStopReason(lastAssistant.stopReason);
      const result: RuntimeResult = {
        messages,
        stopReason,
        ...(lastAssistant === undefined ? {} : { usage: fromPiUsage(lastAssistant.usage) }),
        ...(agent.state.errorMessage === undefined ? {} : { errorMessage: agent.state.errorMessage }),
      };
      if (stopReason === "error") await this.#publish({ type: "run_error", step: requestStep, error: new Error(result.errorMessage ?? "Model request failed") });
      await this.#inboxDurability;
      await this.#publish({ type: "run_end", stopReason });
      return result;
    } catch (error) {
      const stopReason = this.#abortController.signal.aborted ? "aborted" : "error";
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.#agent !== undefined) messages = fromPiMessages(this.#agent.state.messages);
      if (stopReason === "error") await this.#publish({ type: "run_error", step: requestStep, error });
      await this.#inboxDurability;
      await this.#publish({ type: "run_end", stopReason });
      return { messages, stopReason, errorMessage };
    } finally {
      this.#channel.close();
    }
  }

  async #handleEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "agent_start":
        await this.#publish({ type: "run_start", runId: this.request.runId });
        break;
      case "turn_start":
        this.#turnIndex += 1;
        this.#firstTokenAt = undefined;
        await this.#publish({ type: "turn_start", index: this.#turnIndex });
        break;
      case "message_update":
        if ((event.assistantMessageEvent.type === "text_delta" || event.assistantMessageEvent.type === "thinking_delta") && this.#firstTokenAt === undefined) this.#firstTokenAt = Date.now();
        if (event.assistantMessageEvent.type === "text_delta") {
          await this.#publish({ type: "text_delta", delta: event.assistantMessageEvent.delta });
        } else if (event.assistantMessageEvent.type === "thinking_delta") {
          await this.#publish({ type: "reasoning_delta", delta: event.assistantMessageEvent.delta });
        } else if (event.assistantMessageEvent.type === "toolcall_end") {
          const call = event.assistantMessageEvent.toolCall;
          await this.#publish({
            type: "tool_call",
            call: {
              type: "tool_call",
              id: toolCallId(call.id),
              name: call.name,
              arguments: call.arguments,
            },
          });
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          if (this.#preStepRejected && event.message.content.length === 0) break;
          const stopReason = fromPiStopReason(event.message.stopReason);
          await this.#publish({
            type: "assistant_message",
            message: fromPiAssistantMessage(event.message),
            usage: fromPiUsage(event.message.usage),
            stopReason,
            ...(stopReason === "aborted" ? { interrupted: true } : {}),
          });
        } else if (event.message.role === "user") {
          const message = fromPiMessages([event.message])[0];
          if (message?.role === "user") {
            this.#recordClaim(message);
            await this.#inboxDurability;
            await this.#publish({ type: "user_message", message });
            this.#publishPending();
          }
        }
        break;
      case "tool_execution_start":
        break;
      case "tool_execution_update":
        await this.#publish({
          type: "tool_progress",
          callId: toolCallId(event.toolCallId),
          content: fromPiToolContent(event.partialResult?.content ?? []),
        });
        break;
      case "tool_execution_end":
        await this.#publish({
          type: "tool_result",
          callId: toolCallId(event.toolCallId),
          name: event.toolName,
          result: fromPiToolResult(event.result, event.isError),
        });
        break;
      case "turn_end": {
        const assistant = event.message.role === "assistant" ? event.message : undefined;
        await this.#publish({
          type: "turn_end",
          index: this.#turnIndex,
          ...(assistant === undefined ? {} : { usage: fromPiUsage(assistant.usage) }),
          ...(assistant === undefined ? {} : { stopReason: fromPiStopReason(assistant.stopReason) }),
          ...(this.#firstTokenAt === undefined ? {} : { firstTokenAt: this.#firstTokenAt }),
        });
        break;
      }
      case "agent_end":
      case "message_start":
        break;
    }
  }

  #turnIndex = -1;
  #firstTokenAt: number | undefined = undefined;

  async #publish(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
    this.#channel.push(event);
  }

  #recordInbox(event: Omit<Extract<RuntimeEvent, { type: "inbox_spliced" }>, "type">): void {
    const target = event.target === "next-turn" ? this.#durableNextTurn : this.#durableNextStep;
    const removed = target.splice(event.start, event.removedCount ?? 0, ...structuredClone(event.inserted));
    this.#inboxDurability = this.#inboxDurability.then(() => this.#publish({ type: "inbox_spliced", ...event, ...(removed.length === 0 ? {} : { removed }) }));
  }

  #recordClaim(message: import("@seal-harness/core").UserMessage): void {
    if (message.id === undefined) return;
    for (const [target, queue] of [["next-step", this.#durableNextStep], ["next-turn", this.#durableNextTurn]] as const) {
      const index = queue.findIndex((entry) => entry.id === message.id);
      if (index >= 0) { this.#recordInbox({ target, start: index, removedCount: 1, inserted: [] }); return; }
    }
  }

  #recordPendingUpdate(before: readonly PendingAgentMessage[], id: import("@seal-harness/core").MessageId, action: PendingMessageAction): void {
    const prior = before.find((entry) => entry.id === id); if (prior === undefined) return;
    const same = before.filter((entry) => entry.placement === prior.placement); const start = same.findIndex((entry) => entry.id === id);
    const target = prior.placement === "queued" ? "next-turn" as const : "next-step" as const;
    if (action.kind === "edit") {
      const current = this.pendingMessages().find((entry) => entry.id === id)?.message;
      if (current !== undefined) this.#recordInbox({ target, start, removedCount: 1, inserted: [current], outcome: "canceled" });
    } else {
      this.#recordInbox({ target, start, removedCount: 1, inserted: [], outcome: "canceled" });
      if (action.kind === "steer") {
        const current = this.pendingMessages().find((entry) => entry.id === id)?.message;
        if (current !== undefined) this.#recordInbox({ target: "next-step", start: this.pendingMessages().filter((entry) => entry.placement === "steering").length - 1, inserted: [current] });
      }
    }
  }

  #publishPending(): void {
    const snapshot = this.pendingMessages();
    for (const listener of this.#pendingListeners) listener(snapshot);
  }
}

interface PiMutableQueue { messages: import("@earendil-works/pi-agent-core").AgentMessage[] }
interface PiQueueOwner { steeringQueue: PiMutableQueue; followUpQueue: PiMutableQueue }

/** Pinned pi-agent-core 0.84.3 stores the actual consumed inbox in these arrays. */
function piQueues(agent: Agent): PiQueueOwner {
  const candidate = agent as unknown as Partial<PiQueueOwner>;
  if (!Array.isArray(candidate.steeringQueue?.messages) || !Array.isArray(candidate.followUpQueue?.messages)) throw new Error("pi-agent-core queue layout is incompatible with Seal Harness");
  return candidate as PiQueueOwner;
}

function identifyUserMessage(message: AgentMessage): AgentMessage {
  return message.role === "user" && message.id === undefined ? { ...message, id: messageId(randomUUID()) } : message;
}

function pendingCore(messages: readonly AgentMessage[], placement: PendingAgentMessage["placement"]): PendingAgentMessage[] {
  return messages.flatMap((message) => message.role === "user" && message.id !== undefined ? [{ id: message.id, placement, message }] : []);
}

function pendingPi(messages: readonly import("@earendil-works/pi-agent-core").AgentMessage[], placement: PendingAgentMessage["placement"]): PendingAgentMessage[] {
  return pendingCore(fromPiMessages(messages), placement);
}

function assertUniquePending(current: readonly PendingAgentMessage[], inserted: readonly import("@seal-harness/core").UserMessage[], placement: PendingAgentMessage["placement"], start: number, deleteCount: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(deleteCount) || deleteCount < 0) throw new TypeError("pending splice requires integer start and non-negative deleteCount");
  const target = current.filter((entry) => entry.placement === placement);
  const offset = start < 0 ? Math.max(target.length + start, 0) : Math.min(start, target.length);
  const removed = new Set(target.slice(offset, offset + deleteCount).map((entry) => entry.id));
  const ids = new Set(current.filter((entry) => !removed.has(entry.id)).map((entry) => entry.id));
  for (const message of inserted) {
    if (message.id === undefined) throw new Error("pending splice failed to assign a message id");
    if (ids.has(message.id)) throw new Error(`pending message id is already queued: ${message.id}`);
    ids.add(message.id);
  }
}

function piMessageIndex(messages: readonly import("@earendil-works/pi-agent-core").AgentMessage[], id: import("@seal-harness/core").MessageId): number {
  return messages.findIndex((message) => fromPiMessages([message])[0]?.role === "user" && (fromPiMessages([message])[0] as import("@seal-harness/core").UserMessage).id === id);
}

function updateCoreQueue(followUps: AgentMessage[], steering: AgentMessage[], id: import("@seal-harness/core").MessageId, action: PendingMessageAction): PendingMessageUpdate {
  const followIndex = followUps.findIndex((message) => message.role === "user" && message.id === id);
  const steeringIndex = steering.findIndex((message) => message.role === "user" && message.id === id);
  const target = followIndex >= 0 ? { values: followUps, index: followIndex, placement: "queued" as const } : steeringIndex >= 0 ? { values: steering, index: steeringIndex, placement: "steering" as const } : undefined;
  if (target === undefined) return "not-found";
  if (action.kind === "steer" && target.placement !== "queued") return "steer-unavailable";
  const current = target.values[target.index];
  if (current?.role !== "user") return "not-found";
  if (action.kind === "edit") target.values[target.index] = { ...current, content: action.content };
  else {
    target.values.splice(target.index, 1);
    if (action.kind === "steer") steering.push(current);
  }
  return "updated";
}

function createPiTools(
  toolService: ToolService,
  request: RuntimeStartRequest,
  control: { concludesTurn: boolean; errors: Map<string, boolean> },
  injectContext: (message: AgentMessage) => void,
  reportDispatch: (event: import("@seal-harness/core").ToolDispatchEvent) => Promise<void>,
): AgentTool[] {
  return toolService.definitions(request.sessionId).map((definition): AgentTool => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: Type.Unsafe({ ...definition.inputSchema }),
    async execute(callId, params, signal, onUpdate) {
      const result = await toolService.execute({
        callId: toolCallId(callId),
        sessionId: request.sessionId,
        cwd: request.cwd,
        name: definition.name,
        input: params as import("@seal-harness/core").JsonObject,
        signal: signal ?? new AbortController().signal,
        reportProgress: (content) => {
          onUpdate?.({ content: toPiToolContent(content), details: {} });
        },
        reportDispatch,
      });
      control.errors.set(callId, result.isError === true);
      for (const message of result.additionalContexts ?? []) injectContext(message);
      if (result.concludesTurn === true) control.concludesTurn = true;
      return {
        content: toPiToolContent(result.content),
        details: result.details ?? {},
      };
    },
  }));
}

function toPiToolContent(content: readonly import("@seal-harness/core").ContentBlock[]) {
  return content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (block.type === "image") {
      return { type: "image" as const, data: block.data, mimeType: block.mimeType };
    }
    return { type: "text" as const, text: `[attachment:${block.id}]` };
  });
}

function fromPiToolContent(content: readonly any[]): import("@seal-harness/core").ContentBlock[] {
  const converted: import("@seal-harness/core").ContentBlock[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      converted.push({ type: "text", text: block.text });
      continue;
    }
    if (block?.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
      converted.push({ type: "image", data: block.data, mimeType: block.mimeType });
    }
  }
  return converted;
}

function fromPiToolResult(result: any, isError: boolean): ToolResult {
  return {
    content: fromPiToolContent(result?.content ?? []),
    ...(result?.details === undefined ? {} : { details: result.details }),
    isError,
  };
}

function fromPiStopReason(reason: PiAssistantMessage["stopReason"]): ModelStopReason {
  if (reason === "toolUse" || reason === "deferred") return "tool_call";
  if (reason === "pending") return "stop";
  return reason;
}

function fromPiUsage(usage: Usage): ModelUsage {
  const routes = (usage as Usage & { readonly sealRoutes?: readonly import("@seal-harness/core").ModelRef[] }).sealRoutes;
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
    ...(routes === undefined ? {} : { routes }),
    costUsd: usage.cost.total,
  };
}
