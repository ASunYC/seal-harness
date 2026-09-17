import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { DefaultResourceLoader, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, AgentRun, AgentRuntime, ModelService, PendingAgentMessage, PendingMessageAction, PendingMessageUpdate, RuntimeEvent, RuntimeResult, RuntimeStartRequest, ToolService, UserMessage } from "@seal-harness/core";
import { messageId, toolCallId } from "@seal-harness/core";
import { AsyncChannel } from "./async-channel.js";
import { createSealCodingSession, selectSealCodingModel } from "./coding-session.js";
import { createPiModel } from "./model-bridge.js";
import { fromPiAssistantMessage, fromPiMessages, toPiMessage } from "./messages.js";
import { createPiTools, fromPiToolContent, fromPiToolResult, fromPiStopReason, fromPiUsage } from "./runtime-tools.js";
import { importSealHistory } from "./session-import.js";
import { openNativeSession } from "./session-storage.js";

export interface PiRuntimeOptions {
  readonly dataHome?: string;
  readonly toolExecution?: "parallel" | "sequential";
  readonly steeringMode?: "all" | "one-at-a-time";
  readonly followUpMode?: "all" | "one-at-a-time";
  /** Passed to PI SettingsManager; PI alone decides when/how to compact. */
  readonly compaction?: { readonly enabled?: boolean; readonly reserveTokens?: number; readonly keepRecentTokens?: number };
}
export class PiAgentRuntime implements AgentRuntime {
  readonly managesCompaction = true;
  constructor(readonly modelService: ModelService, readonly toolService: ToolService | undefined, readonly options: PiRuntimeOptions = {}) {}
  start(request: RuntimeStartRequest): AgentRun { return new PiAgentRun(this.modelService, this.toolService, this.options, request); }
}
class PiAgentRun implements AgentRun {
  readonly #channel = new AsyncChannel<RuntimeEvent>();
  readonly #abort = new AbortController();
  readonly #listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  readonly #pendingListeners = new Set<(messages: readonly PendingAgentMessage[]) => void>();
  readonly #pending: PendingAgentMessage[] = [];
  readonly #claimed: UserMessage[] = [];
  readonly #control = { concludesTurn: false, errors: new Map<string, boolean>() };
  #session: AgentSession | undefined;
  #durability = Promise.resolve();
  #turn = -1;
  #firstTokenAt: number | undefined;
  #initial: UserMessage | undefined;
  #inputRejected = false;
  #extensionFailure: Error | undefined;
  #config: import("@seal-harness/core").RuntimeModelRequestConfig;
  readonly result: Promise<RuntimeResult>;
  constructor(models: ModelService, tools: ToolService | undefined, options: PiRuntimeOptions, readonly request: RuntimeStartRequest) {
    this.#config = { model: { provider: request.model.provider, model: request.model.model }, ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }), ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }) };
    this.#pending.push(...structuredClone(request.pendingMessages ?? []));
    if (request.signal?.aborted) this.#abort.abort(request.signal.reason);
    else request.signal?.addEventListener("abort", () => this.abort(request.signal?.reason), { once: true });
    this.result = this.#execute(models, tools, options);
  }
  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> { return this.#channel[Symbol.asyncIterator](); }
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  subscribePending(listener: (messages: readonly PendingAgentMessage[]) => void): () => void { this.#pendingListeners.add(listener); return () => { this.#pendingListeners.delete(listener); }; }
  abort(reason?: unknown): void {
    this.#abort.abort(reason);
    // Preserve Seal's durable pending records, but prevent SDK post-run queue
    // continuation from starting another request after the user pressed stop.
    this.#session?.clearQueue();
    // Settings are run-local. Stop post-turn automatic work after a user abort.
    this.#session?.setAutoCompactionEnabled(false);
    this.#session?.abortCompaction();
    void this.#session?.abort();
  }
  pendingMessages(): readonly PendingAgentMessage[] { return structuredClone(this.#pending); }
  steer(message: AgentMessage): void { this.#enqueue(message, "steering"); }
  followUp(message: AgentMessage): void { this.#enqueue(message, "queued"); }
  #enqueue(message: AgentMessage, placement: PendingAgentMessage["placement"]): void {
    if (message.role !== "user") throw new TypeError("PI session queues accept user messages only");
    this.splicePending(placement, this.#pending.filter(entry => entry.placement === placement).length, 0, [message]);
  }
  updatePendingMessage(id: import("@seal-harness/core").MessageId, action: PendingMessageAction): PendingMessageUpdate {
    const entry = this.#pending.find(item => item.id === id);
    if (!entry) return "not-found";
    if (action.kind === "steer" && entry.placement !== "queued") return "steer-unavailable";
    const index = this.#pending.filter(item => item.placement === entry.placement).findIndex(item => item.id === id);
    this.splicePending(entry.placement, index, 1, action.kind === "edit" ? [{ ...entry.message, content: action.content }] : []);
    if (action.kind === "steer") this.#enqueue(entry.message, "steering");
    return "updated";
  }
  splicePending(placement: PendingAgentMessage["placement"], start: number, deleteCount: number, inserted: readonly UserMessage[]): readonly UserMessage[] {
    if (!Number.isInteger(start) || !Number.isInteger(deleteCount) || deleteCount < 0) throw new TypeError("Invalid pending splice");
    const target = this.#pending.filter(entry => entry.placement === placement);
    const offset = start < 0 ? Math.max(target.length + start, 0) : Math.min(start, target.length);
    const removed = target.slice(offset, offset + deleteCount);
    const removedIds = new Set(removed.map(entry => entry.id));
    const ids = new Set(this.#pending.filter(entry => !removedIds.has(entry.id)).map(entry => entry.id));
    const added = inserted.map(message => {
      queueContent(message); // Reject unresolved/unsupported blocks before changing either queue.
      const id = message.id ?? messageId(randomUUID());
      if (ids.has(id)) throw new Error(`pending message id is already queued: ${id}`);
      ids.add(id);
      return { id, placement, message: { ...structuredClone(message), id } };
    });
    target.splice(offset, deleteCount, ...added);
    const others = this.#pending.filter(entry => entry.placement !== placement);
    this.#pending.splice(0, this.#pending.length, ...others, ...target);
    this.#record({ type: "inbox_spliced", target: placement === "queued" ? "next-turn" : "next-step", start: offset,
      ...(removed.length ? { removedCount: removed.length, removed: removed.map(entry => entry.message), outcome: "canceled" as const } : {}),
      inserted: added.map(entry => entry.message) });
    this.#syncQueue(); this.#notifyPending();
    return removed.map(entry => entry.message);
  }
  #syncQueue(): void {
    const session = this.#session; if (!session) return;
    session.clearQueue();
    for (const entry of this.#pending) {
      const [first, ...images] = queueContent(entry.message);
      const text = first.text;
      const operation = entry.placement === "queued" ? session.followUp(text, images) : session.steer(text, images);
      void operation.catch(error => this.abort(error));
    }
  }
  #notifyPending(): void { for (const listener of this.#pendingListeners) listener(this.pendingMessages()); }
  #record(event: RuntimeEvent): void { this.#durability = this.#durability.then(() => this.#publish(event)); }
  async #publish(event: RuntimeEvent): Promise<void> { for (const listener of this.#listeners) await listener(event); this.#channel.push(event); }

  #extensions(api: ExtensionAPI, models: ModelService): void {
    api.on("input", async () => {
      const original = this.#initial;
      let replacement = original;
      if (original && this.request.hooks?.preStep) {
        const decision = await this.request.hooks.preStep({ turn: 1, step: 1, signal: this.#abort.signal, messages: [original] });
        this.#abort.signal.throwIfAborted();
        await this.#publish({ type: "pre_step", original: [original], messages: decision.kind === "enter" ? decision.messages : [], rejected: decision.kind === "reject" });
        if (decision.kind === "reject") { this.#inputRejected = true; this.#initial = undefined; return { action: "handled" }; }
        if (decision.messages.length === 0) { this.#inputRejected = true; this.#initial = undefined; return { action: "handled" }; }
        // PI's prompt API accepts one user input. Persist preceding context via
        // SessionManager's public append API, then restore its authoritative
        // context through Agent's documented state.messages setter before prompting.
        // No queue internals or execution loop are accessed here.
        const session = this.#session!;
        const preceding = decision.messages.slice(0, -1).map(message => toPiMessage(message, session.model!));
        for (const message of preceding) session.sessionManager.appendMessage(message);
        if (preceding.length) session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
        replacement = decision.messages.at(-1)!;
        this.#initial = replacement;
      }
      if (replacement && replacement !== original) return { action: "transform",
        text: replacement.content.filter(block => block.type === "text").map(block => block.text).join("\n"),
        images: replacement.content.flatMap(block => block.type === "image" ? [{ type: "image" as const, data: block.data, mimeType: block.mimeType }] : []) };
      return { action: "continue" };
    });
    api.on("context", async event => {
      await this.#durability;
      await this.#publish({ type: "runtime_activity", phase: "preparing" });
      if (this.request.hooks?.request) {
        this.#config = await this.request.hooks.request({ turn: 1, step: this.#turn + 1, signal: this.#abort.signal, config: this.#config });
        this.#abort.signal.throwIfAborted();
        await selectSealCodingModel(this.#session!, models, this.#config);
      }
      // Compatibility context producers may enqueue plugin context during input
      // preflight (e.g. time/sandbox notes). Materialize it before the first PI
      // prompt rather than allowing it to become a second user turn.
      const contextEntries = this.#pending.filter(entry => entry.placement === "steering" && entry.message.source?.kind === "plugin");
      for (const entry of contextEntries) {
        const offset = this.#pending.filter(item => item.placement === "steering").findIndex(item => item.id === entry.id);
        this.#pending.splice(this.#pending.findIndex(item => item.id === entry.id), 1);
        this.#record({ type: "inbox_spliced", target: "next-step", start: offset, removedCount: 1, removed: [entry.message], inserted: [] });
        await this.#durability;
        this.#session!.sessionManager.appendMessage(toPiMessage(entry.message, this.#session!.model!));
        await this.#publish({ type: "user_message", message: entry.message });
      }
      if (contextEntries.length) {
        this.#session!.agent.state.messages = this.#session!.sessionManager.buildSessionContext().messages;
        this.#syncQueue(); this.#notifyPending();
      }

      await this.#publish({ type: "pre_step", original: [], messages: [], rejected: false });
      await this.#publish({ type: "request_header", reason: this.#turn <= 0 ? "initial" : "series", header: {
        config: { provider: this.#config.model.provider, model: this.#config.model.model,
          ...(this.#config.reasoning === undefined ? {} : { reasoningEffort: this.#config.reasoning }),
          ...(this.#config.maxTokens === undefined ? {} : { maxTokens: this.#config.maxTokens }) },
        ...(this.request.systemPrompt ? { system: this.request.systemPrompt } : {}),
      } });
      await this.#publish({ type: "runtime_activity", phase: "waiting-model" });
      return { messages: contextEntries.length ? this.#session!.sessionManager.buildSessionContext().messages : event.messages };
    });
    api.on("message_start", event => {
      if (event.message.role !== "user" || this.#initial) return;
      const content = JSON.stringify(event.message.content);
      // SDK steer/followUp join text and place images after it. Match that public
      // input representation, then restore the original blocks at message_end.
      // Steering wins over follow-up when both carry identical visible content.
      const candidates = this.#pending.filter(entry => JSON.stringify(queueContent(entry.message)) === content);
      const selected = candidates.find(entry => entry.placement === "steering") ?? candidates[0];
      const index = selected ? this.#pending.indexOf(selected) : -1;
      if (index < 0) return;
      const entry = this.#pending[index]!;
      const offset = this.#pending.slice(0, index).filter(item => item.placement === entry.placement).length;
      this.#pending.splice(index, 1); this.#claimed.push(entry.message);
      this.#record({ type: "inbox_spliced", target: entry.placement === "queued" ? "next-turn" : "next-step", start: offset, removedCount: 1, removed: [entry.message], inserted: [] });
      this.#notifyPending();
    });
    api.on("message_end", async event => {
      if (event.message.role === "user") {
        const core = this.#initial ?? this.#claimed.shift(); this.#initial = undefined;
        const original = core ? toPiMessage(core, this.#session!.model!) : undefined;
        const message = original?.role === "user" ? { ...original, timestamp: event.message.timestamp } : event.message;
        await this.#handleEvent({ type: "message_end", message }); return { message };
      }
      await this.#handleEvent(event as AgentEvent);
      if (event.message.role === "assistant" && event.message.stopReason === "error" && !this.#abort.signal.aborted) {
        // Compatibility notification only. PI owns retry classification, budget,
        // backoff and continuation; a DSH callback cannot force another attempt.
        await this.request.hooks?.requestError?.({ turn: 1, step: this.#turn + 1, signal: this.#abort.signal,
          provider: event.message.provider, failure: { message: event.message.errorMessage ?? "Model request failed", code: "UNKNOWN" } });
      }
    });
    api.on("agent_start", event => this.#handleEvent(event));
    api.on("turn_start", event => this.#handleEvent(event));
    api.on("message_update", event => this.#handleEvent(event));
    api.on("tool_execution_update", event => this.#handleEvent(event));
    api.on("tool_execution_end", event => this.#handleEvent(event));
    api.on("turn_end", async event => {
      await this.#handleEvent(event);
      const stopping = event.message.role === "assistant" && !event.message.content.some(block => block.type === "toolCall");
      if (stopping && !this.#abort.signal.aborted) await this.request.hooks?.turnStopping?.({ turn: 1, signal: this.#abort.signal });
      if (this.#control.concludesTurn && this.#pending.length === 0) void this.#session?.abort();
    });
    api.on("tool_result", event => { const isError = this.#control.errors.get(event.toolCallId); this.#control.errors.delete(event.toolCallId); return isError === undefined ? undefined : { isError }; });
  }
  async #execute(models: ModelService, tools: ToolService | undefined, options: PiRuntimeOptions): Promise<RuntimeResult> {
    let messages = this.request.messages;
    let release: (() => Promise<void>) | undefined;
    try {
      this.#abort.signal.throwIfAborted();
      const model = await createPiModel(models, this.request.model.provider, this.request.model.model);
      for (const entry of this.#pending) queueContent(entry.message);
      const last = this.request.messages.at(-1);
      if (last?.role !== "user") throw new Error("A PI coding session requires a final user input");
      this.#initial = last;
      const inputs = this.request.inputMessages ?? [last];
      if (inputs.length === 0 || inputs.length > this.request.messages.length || inputs.at(-1)?.role !== "user") throw new Error("Invalid native session input suffix");
      if (JSON.stringify(inputs) !== JSON.stringify(this.request.messages.slice(-inputs.length))) throw new Error("Native session inputs must match the prepared suffix");
      const storage = options.dataHome === undefined ? undefined : await openNativeSession(options.dataHome, this.request.sessionId, this.request.cwd);
      release = storage?.release;
      const manager = storage?.manager ?? SessionManager.inMemory(this.request.cwd);
      importSealHistory(manager, this.request.sessionId, this.request.messages.slice(0, -inputs.length), model);
      for (const message of inputs.slice(0, -1)) manager.appendMessage(toPiMessage(message, model));
      const settings = SettingsManager.inMemory({ compaction: { enabled: true,
        reserveTokens: Math.min(16384, Math.max(1, Math.floor(model.contextWindow / 4))),
        keepRecentTokens: Math.min(20000, Math.max(1, Math.floor(model.contextWindow / 3))), ...options.compaction }, retry: { enabled: true },
        steeringMode: options.steeringMode ?? "one-at-a-time", followUpMode: options.followUpMode ?? "one-at-a-time" });
      const agentDir = options.dataHome === undefined ? join(tmpdir(), "seal-sdk-isolated") : join(options.dataHome, "pi-agent");
      const loader = new DefaultResourceLoader({ cwd: this.request.cwd, agentDir, settingsManager: settings,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        systemPromptOverride: () => this.request.systemPrompt, extensionFactories: [api => this.#extensions(api, models)] });
      await loader.reload();
      const piTools = tools ? createPiTools(tools, this.request, this.#control, message => this.steer(message), event => this.#publish({ type: "tool_dispatch", event })) : [];
      this.#session = await createSealCodingSession({ request: this.request, modelService: models, agentDir,
        sessionManager: manager, settingsManager: settings, resourceLoader: loader,
        tools: piTools.map(tool => ({ ...tool, executionMode: options.toolExecution ?? "parallel" })), requestConfig: () => this.#config, signal: this.#abort.signal });
      await this.#session.bindExtensions({ onError: error => {
        this.#extensionFailure ??= new Error(`Seal PI extension ${error.event} failed: ${error.error}`);
        this.abort(this.#extensionFailure);
      } });
      // SDK event subscribers are synchronous. Serialize Seal observers through
      // the existing durability barrier, never make them another compaction loop.
      let beforeCompaction: readonly import("@seal-harness/core").AgentMessage[] = [];
      this.#session.subscribe(event => {
        if (event.type === "compaction_start") {
          beforeCompaction = fromPiMessages(manager.buildSessionContext().messages);
          this.#record({ type: "compaction_activity", reason: event.reason, state: "started" });
        } else if (event.type === "compaction_end") {
          if (event.result) {
            const context = fromPiMessages(manager.buildSessionContext().messages);
            const summary = context[0];
            const replacedCount = beforeCompaction.length - (context.length - 1);
            if (summary?.role === "user" && replacedCount > 0) this.#record({ type: "context_compacted",
              summaryMessage: summary, replacedMessages: beforeCompaction.slice(0, replacedCount) });
          }
          this.#record({ type: "compaction_activity", reason: event.reason, state: "finished",
          outcome: event.aborted || this.#abort.signal.aborted ? "aborted" : event.result ? "completed" : "failed",
          ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }) });
        }
      });
      this.#abort.signal.throwIfAborted(); this.#syncQueue();
      const input = toPiMessage(last, model);
      if (input.role !== "user") throw new Error("Invalid user input");
      await this.#session.sendUserMessage(input.content, { expandPromptTemplates: false });
      if (this.#extensionFailure) throw this.#extensionFailure;
      await this.#durability;
      messages = fromPiMessages(this.#session.messages);
      const assistant = this.#inputRejected ? undefined : [...this.#session.messages].reverse().find(message => message.role === "assistant");
      const stopReason = this.#abort.signal.aborted ? "aborted" : this.#control.concludesTurn ? "stop" : assistant ? fromPiStopReason(assistant.stopReason) : "stop";
      const result: RuntimeResult = { messages, stopReason, ...(assistant ? { usage: fromPiUsage(assistant.usage) } : {}), ...(assistant?.errorMessage ? { errorMessage: assistant.errorMessage } : {}) };
      if (stopReason === "error") await this.#publish({ type: "run_error", step: this.#turn + 1, error: new Error(result.errorMessage ?? "Model request failed") });
      await this.#publish({ type: "run_end", stopReason }); return { ...result, messagesEmitted: true };
    } catch (error) {
      const stopReason = this.#abort.signal.aborted && !this.#extensionFailure ? "aborted" : "error";
      if (this.#session) messages = fromPiMessages(this.#session.messages);
      if (stopReason === "error") await this.#publish({ type: "run_error", step: this.#turn + 1, error });
      await this.#publish({ type: "run_end", stopReason }); return { messages, stopReason, messagesEmitted: true, errorMessage: String(error) };
    } finally {
      this.#session?.dispose();
      try { await release?.(); } finally { this.#channel.close(); }
    }
  }
  async #handleEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "agent_start":
        // PI may finish a cancelled preflight compaction and enter prompt();
        // cancel that native run through its public API before provider I/O.
        if (this.#abort.signal.aborted) void this.#session?.abort();
        await this.#publish({ type: "run_start", runId: this.request.runId }); break;
      case "turn_start": this.#firstTokenAt = undefined; await this.#publish({ type: "turn_start", index: ++this.#turn }); break;
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta" || update.type === "thinking_delta") { this.#firstTokenAt ??= Date.now(); await this.#publish({ type: update.type === "text_delta" ? "text_delta" : "reasoning_delta", delta: update.delta }); }
        else if (update.type === "toolcall_end") await this.#publish({ type: "tool_call", call: { type: "tool_call", id: toolCallId(update.toolCall.id), name: update.toolCall.name, arguments: update.toolCall.arguments } });
        break;
      }
      case "message_end":
        if (event.message.role === "assistant") await this.#publish({ type: "assistant_message", message: fromPiAssistantMessage(event.message), usage: fromPiUsage(event.message.usage), stopReason: fromPiStopReason(event.message.stopReason), ...(event.message.stopReason === "aborted" ? { interrupted: true as const } : {}) });
        else if (event.message.role === "user") { await this.#durability; const message = fromPiMessages([event.message])[0]; if (message?.role === "user") await this.#publish({ type: "user_message", message }); }
        break;
      case "tool_execution_update": await this.#publish({ type: "tool_progress", callId: toolCallId(event.toolCallId), content: fromPiToolContent(event.partialResult?.content ?? []) }); break;
      case "tool_execution_end": await this.#publish({ type: "tool_result", callId: toolCallId(event.toolCallId), name: event.toolName, result: fromPiToolResult(event.result, event.isError) }); break;
      case "turn_end": await this.#publish({ type: "turn_end", index: this.#turn, ...(event.message.role === "assistant" ? { usage: fromPiUsage(event.message.usage), stopReason: fromPiStopReason(event.message.stopReason) } : {}), ...(this.#firstTokenAt ? { firstTokenAt: this.#firstTokenAt } : {}) }); break;
    }
  }
}

/** Exactly the visible representation accepted by PI's public queue methods. */
function queueContent(message: UserMessage): [import("@earendil-works/pi-ai").TextContent, ...import("@earendil-works/pi-ai").ImageContent[]] {
  for (const block of message.content) {
    if (block.type !== "text" && block.type !== "image") throw new TypeError("PI queue requires resolved text/image content");
  }
  return [
    { type: "text", text: message.content.filter(block => block.type === "text").map(block => block.text).join("\n") },
    ...message.content.flatMap(block => block.type === "image" ? [{ type: "image" as const, data: block.data, mimeType: block.mimeType }] : []),
  ];
}
