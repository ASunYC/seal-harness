import { randomUUID } from "node:crypto";
import {
  agentServiceToken,
  agentPresetServiceToken,
  deriveSessionMessages,
  jobServiceToken,
  messageId,
  sessionId,
  sessionStoreToken,
  subagentServiceToken,
  text,
  toolServiceToken,
  userMessage,
  type AgentExecution,
  type AgentMessage,
  type AgentService,
  type AgentPresetService,
  type JsonObject,
  type JsonValue,
  type JobService,
  type ModelRef,
  type SealHarnessEvents,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type SpawnSubagentRequest,
  type SubagentService,
  type SubagentSnapshot,
  type ToolDefinition,
  type ToolService,
  type WaitSubagentsResult,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

const PARENT_KEY = "sealHarness.parentSessionId";
const LABEL_KEY = "sealHarness.subagentLabel";
const TASK_KEY = "sealHarness.subagentTask";

export interface SubagentToolsConfig {
  readonly maxConcurrentChildrenPerParent?: number;
  readonly maxWaitMs?: number;
  readonly idFactory?: () => string;
  /** Keep the legacy global subagent tool catalog. Agent Team profiles disable it and install scoped-equivalent Team tools. */
  readonly registerTools?: boolean;
}

interface LiveChild {
  readonly execution: AgentExecution;
  readonly settled: Promise<void>;
  readonly jobId?: string;
  readonly disposeStructuredTool?: () => void;
}

export class DefaultSubagentService implements SubagentService {
  readonly #live = new Map<SessionId, LiveChild>();
  readonly #structuredResults = new Map<SessionId, JsonValue>();

  constructor(
    readonly agents: AgentService,
    readonly sessions: SessionStore,
    readonly maxConcurrentChildrenPerParent = 8,
    readonly maxWaitMs = 120_000,
    readonly idFactory: () => string = randomUUID,
    readonly jobs?: JobService,
    readonly agentPresets?: AgentPresetService,
    readonly tools?: ToolService,
  ) {}

  async spawn(request: SpawnSubagentRequest): Promise<SubagentSnapshot> {
    const children = await this.list(request.parentSessionId);
    if (children.filter(child => child.status === "running").length >= this.maxConcurrentChildrenPerParent) {
      throw new Error(`concurrent subagent limit reached (${this.maxConcurrentChildrenPerParent})`);
    }
    const parent = await this.requireSession(request.parentSessionId);
    const model = request.model ?? latestModel(parent);
    const childId = request.sessionId ?? sessionId(`agent-${this.idFactory()}`);
    if (await this.sessions.read(childId) !== undefined) throw new Error(`subagent session already exists: ${childId}`);
    const label = request.label?.trim() || `Agent ${children.length + 1}`;
    const childMetadata = { ...metadata(parent), [PARENT_KEY]: request.parentSessionId, [LABEL_KEY]: label, [TASK_KEY]: request.prompt };
    if (request.inheritParentContext === true) {
      const completed = [...parent.events].reverse().find(entry => entry.event.type === "run.completed");
      if (completed !== undefined) {
        await this.agents.fork({ sourceSessionId: request.parentSessionId, targetSessionId: childId, throughVersion: completed.sequence, metadata: childMetadata });
      }
    }
    let structuredResult: JsonValue | undefined;
    if (request.outputSchema !== undefined && this.tools === undefined) throw new Error("structured subagents require ToolService");
    const disposeStructuredTool = request.outputSchema === undefined ? undefined : this.tools!.register({
      name: "structured_output",
      description: "Report the final structured result exactly once. Arguments must match this tool's schema.",
      inputSchema: request.outputSchema,
      classify: () => ({ kind: "tool", toolName: "structured_output", risk: "read", summary: "Record structured subagent result" }),
      async execute(input) {
        structuredResult = input;
        return { content: [text("Structured output recorded.")], details: { recorded: true }, concludesTurn: true };
      },
    }, { ownerSession: childId });
    let execution: AgentExecution;
    try {
      execution = await this.agents.prompt({
      sessionId: childId,
      cwd: request.cwd,
      model,
      prompt: [text(request.prompt + (request.outputSchema === undefined ? "" : "\n\nWhen complete, call `structured_output` exactly once with arguments matching its schema. Do not substitute a prose-only final answer."))],
      metadata: childMetadata,
      ...(this.agentPresets === undefined ? {} : { agentPreset: await this.agentPresets.current(request.parentSessionId) }),
      ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
      });
    } catch (error) {
      disposeStructuredTool?.();
      throw error;
    }
    const jobId = this.registerJob(execution, request.parentSessionId, label);
    this.track(execution, jobId, disposeStructuredTool, () => structuredResult);
    return {
      sessionId: childId, parentSessionId: request.parentSessionId, label, status: "running", model,
      ...(jobId === undefined ? {} : { jobId }),
    };
  }

  async list(parentSessionId: SessionId): Promise<readonly SubagentSnapshot[]> {
    const sessions = await this.sessions.list();
    return sessions
      .filter(candidate => metadata(candidate)[PARENT_KEY] === parentSessionId)
      .map(candidate => snapshot(candidate, this.#live.get(candidate.id), this.#structuredResults.get(candidate.id)))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async listDescendants(parentSessionId: SessionId): Promise<readonly SubagentSnapshot[]> {
    const sessions = await this.sessions.list();
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return sessions.filter((candidate) => {
      let current: SessionSnapshot | undefined = candidate;
      const seen = new Set<SessionId>();
      while (current !== undefined && !seen.has(current.id)) {
        seen.add(current.id);
        const parent = metadata(current)[PARENT_KEY];
        if (parent === parentSessionId) return true;
        if (typeof parent !== "string") return false;
        current = byId.get(sessionId(parent));
      }
      return false;
    }).map((candidate) => snapshot(candidate, this.#live.get(candidate.id), this.#structuredResults.get(candidate.id)))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async wait(
    parentSessionId: SessionId,
    sessionIds: readonly SessionId[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitSubagentsResult> {
    const owned = await this.owned(parentSessionId, sessionIds);
    const ready = owned.filter(item => item.status !== "running");
    if (ready.length > 0 || owned.length === 0) return { completed: ready, timedOut: false };
    const bounded = Math.max(0, Math.min(timeoutMs, this.maxWaitMs));
    if (bounded === 0) return { completed: [], timedOut: true };
    await waitForOne(
      owned.flatMap(item => this.#live.get(item.sessionId)?.settled ?? []),
      bounded,
      signal,
    );
    const after = await this.owned(parentSessionId, sessionIds);
    const completed = after.filter(item => item.status !== "running");
    return { completed, timedOut: completed.length === 0 };
  }

  async send(parentSessionId: SessionId, childId: SessionId, message: AgentMessage): Promise<SubagentSnapshot> {
    const child = await this.requireOwned(parentSessionId, childId);
    const live = this.#live.get(childId);
    if (live !== undefined) {
      live.execution.steer(message);
      return snapshot(child, live, this.#structuredResults.get(childId));
    }
    const created = creation(child);
    const execution = await this.agents.prompt({
      sessionId: childId,
      cwd: created.cwd,
      model: latestModel(child),
      prompt: message.role === "user" ? message.content : [text(messageText(message))],
      ...(message.role !== "user" || message.id === undefined ? {} : { promptMessageId: message.id }),
      ...(message.role !== "user" || message.source === undefined ? {} : { promptSource: message.source }),
    });
    const jobId = this.registerJob(execution, parentSessionId, String(metadata(child)[LABEL_KEY] ?? childId));
    this.track(execution, jobId);
    return snapshot(await this.requireSession(childId), this.#live.get(childId), this.#structuredResults.get(childId));
  }

  async sendMessage(senderId: SessionId, targetId: SessionId, message: AgentMessage): Promise<import("@seal-harness/core").MessageId> {
    const identified = message.role === "user" && message.id !== undefined
      ? message
      : { role: "user" as const, id: messageId(`subagent-message-${this.idFactory()}`), content: message.role === "user" ? message.content : [text(messageText(message))], source: { kind: "agent-message", senderSessionId: senderId } };
    const target = await this.requireSession(targetId);
    const targetParent = metadata(target)[PARENT_KEY];
    if (targetParent === senderId) {
      await this.send(senderId, targetId, identified);
      return identified.id!;
    }
    const sender = await this.requireSession(senderId);
    if (metadata(sender)[PARENT_KEY] !== targetId) throw new Error(`agent ${targetId} is not directly adjacent to ${senderId}`);
    const active = this.agents.active?.(targetId);
    if (active !== undefined) active.steer(identified);
    else {
      const created = creation(target);
      const execution = await this.agents.prompt({
        sessionId: targetId,
        cwd: created.cwd,
        model: latestModel(target),
        prompt: identified.content,
        ...(identified.id === undefined ? {} : { promptMessageId: identified.id }),
        ...(identified.source === undefined ? {} : { promptSource: identified.source }),
      });
      void execution.result.catch(() => {});
    }
    return identified.id!;
  }

  async interrupt(ancestorId: SessionId, targetId: SessionId, reason?: unknown): Promise<boolean> {
    let current = await this.requireSession(targetId);
    const seen = new Set<SessionId>();
    for (;;) {
      if (seen.has(current.id)) throw new Error("cyclic subagent lineage");
      seen.add(current.id);
      const parent = metadata(current)[PARENT_KEY];
      if (parent === ancestorId) break;
      if (typeof parent !== "string") throw new Error(`subagent is not descended from this ancestor: ${targetId}`);
      current = await this.requireSession(sessionId(parent));
    }
    const live = this.#live.get(targetId);
    if (live === undefined) return false;
    live.execution.abort(reason ?? new Error("Subagent interrupted by ancestor"));
    return true;
  }

  async abort(parentSessionId: SessionId, childId: SessionId, reason?: unknown): Promise<boolean> {
    await this.requireOwned(parentSessionId, childId);
    const live = this.#live.get(childId);
    if (live === undefined) return false;
    live.execution.abort(reason ?? new Error("Subagent aborted by parent"));
    return true;
  }

  async dispose(): Promise<void> {
    const live = [...this.#live.values()];
    for (const child of live) child.execution.abort(new Error("Subagent service stopped"));
    await Promise.all(live.map(child => child.settled));
  }

  private track(execution: AgentExecution, jobId?: string, disposeStructuredTool?: () => void, structuredResult?: () => JsonValue | undefined): void {
    const settled = execution.result.then(() => undefined, () => undefined).finally(() => {
      const captured = structuredResult?.();
      if (captured !== undefined) this.#structuredResults.set(execution.sessionId, captured);
      disposeStructuredTool?.();
      if (this.#live.get(execution.sessionId)?.execution === execution) this.#live.delete(execution.sessionId);
    });
    this.#live.set(execution.sessionId, { execution, settled, ...(jobId === undefined ? {} : { jobId }), ...(disposeStructuredTool === undefined ? {} : { disposeStructuredTool }) });
  }

  private registerJob(execution: AgentExecution, ownerSession: SessionId, label: string): string | undefined {
    if (this.jobs === undefined) return undefined;
    let unread = "";
    return this.jobs.start({
      kind: "subagent",
      label,
      ownerSession,
      run: () => ({
        cancel: reason => execution.abort(new Error(reason ?? "Subagent job cancelled")),
        done: execution.result.then(result => {
          const assistant = result.runtime.messages.slice().reverse().find(message => message.role === "assistant");
          unread = assistant === undefined ? "" : messageText(assistant);
          return result.runtime.stopReason === "aborted"
            ? { status: "cancelled" as const, ...(result.runtime.errorMessage === undefined ? {} : { detail: result.runtime.errorMessage }) }
            : result.runtime.stopReason === "error"
              ? { status: "failed" as const, ...(result.runtime.errorMessage === undefined ? {} : { detail: result.runtime.errorMessage }) }
              : { status: "completed" as const };
        }),
        readOutput: () => { const value = unread; unread = ""; return value; },
      }),
    });
  }

  private async owned(parent: SessionId, ids: readonly SessionId[]): Promise<SubagentSnapshot[]> {
    const children = await this.list(parent);
    if (ids.length === 0) return [...children];
    const requested = new Set(ids);
    const selected = children.filter(child => requested.has(child.sessionId));
    if (selected.length !== requested.size) throw new Error("one or more subagents do not belong to this parent");
    return selected;
  }

  private async requireSession(id: SessionId): Promise<SessionSnapshot> {
    const value = await this.sessions.read(id);
    if (value === undefined) throw new Error(`session not found: ${id}`);
    return value;
  }

  private async requireOwned(parent: SessionId, child: SessionId): Promise<SessionSnapshot> {
    const value = await this.requireSession(child);
    if (metadata(value)[PARENT_KEY] !== parent) throw new Error(`subagent does not belong to this parent: ${child}`);
    return value;
  }
}

export const subagentToolsPlugin = definePlugin<SubagentToolsConfig, SealHarnessEvents>({
  name: "subagent-tools",
  provides: [subagentServiceToken],
  requires: [agentServiceToken, sessionStoreToken, toolServiceToken, jobServiceToken],
  optional: [agentPresetServiceToken],
  setup(context, config) {
    const service = new DefaultSubagentService(
      context.use(agentServiceToken),
      context.use(sessionStoreToken),
      positive(config.maxConcurrentChildrenPerParent ?? 8, "maxConcurrentChildrenPerParent"),
      positive(config.maxWaitMs ?? 120_000, "maxWaitMs"),
      config.idFactory,
      context.use(jobServiceToken),
      context.has(agentPresetServiceToken) ? context.use(agentPresetServiceToken) : undefined,
      context.use(toolServiceToken),
    );
    context.provide(subagentServiceToken, service);
    const tools = context.use(toolServiceToken);
    if (config.registerTools !== false) for (const tool of definitions(service)) context.effect(tools.register(tool));
    context.effect(() => service.dispose());
  },
});

function definitions(service: SubagentService): ToolDefinition[] {
  return [
    {
      name: "spawn_agent",
      description: "Start a durable child agent in the background and return immediately.",
      inputSchema: objectSchema({
        prompt: stringSchema("Task for the child agent"),
        label: stringSchema("Short child label"),
        provider: stringSchema("Optional model provider"),
        model: stringSchema("Optional model id; requires provider"),
        reasoning: { type: "string", enum: ["off", "low", "medium", "high", "max"] },
      }, ["prompt"]),
      classify: (_input, context) => action("spawn_agent", "Start a background child agent", context.cwd),
      async execute(input, context) {
        const provider = optionalString(input, "provider");
        const model = optionalString(input, "model");
        const label = optionalString(input, "label");
        const reasoning = optionalString(input, "reasoning") as "off" | "low" | "medium" | "high" | "max" | undefined;
        if ((provider === undefined) !== (model === undefined)) throw new Error("provider and model must be supplied together");
        const child = await service.spawn({
          parentSessionId: context.sessionId,
          cwd: context.cwd,
          prompt: requiredString(input, "prompt"),
          ...(label === undefined ? {} : { label }),
          ...(provider === undefined || model === undefined ? {} : { model: { provider, model } }),
          ...(reasoning === undefined ? {} : { reasoning }),
        });
        return { content: [text(`Started ${child.label} (${child.sessionId})`)], details: jsonSnapshot(child) };
      },
    },
    {
      name: "list_agents",
      description: "List this session's durable child agents and their current status.",
      inputSchema: objectSchema({ scope: { type: "string", enum: ["children", "descendants"], description: "List direct children or the complete descendant tree" } }, []),
      classify: (_input, context) => action("list_agents", "List child agents", context.cwd),
      async execute(input, context) {
        const scope = input.scope === "descendants" ? "descendants" : "children";
        const children = scope === "descendants" && service.listDescendants !== undefined
          ? await service.listDescendants(context.sessionId)
          : await service.list(context.sessionId);
        const entries = listAgentEntries(children, context.sessionId, scope);
        return {
          content: [text(entries.length === 0 ? "(no subagents)" : entries.map((entry) => `${entry.id} · ${entry.label} [status: ${entry.status}]${entry.parent === undefined ? "" : ` [parent: ${entry.parent}, depth: ${entry.depth}]`}`).join("\n"))],
          details: entries,
        };
      },
    },
    {
      name: "wait_agents",
      description: "Wait until at least one selected child agent finishes, or until a timeout.",
      inputSchema: objectSchema({
        session_ids: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
        timeout_ms: { type: "integer", minimum: 0, maximum: 120000 },
      }, []),
      classify: (_input, context) => action("wait_agents", "Wait for child agents", context.cwd),
      async execute(input, context) {
        const ids = Array.isArray(input.session_ids)
          ? input.session_ids.map(value => sessionId(String(value)))
          : [];
        const waited = await service.wait(
          context.sessionId,
          ids,
          typeof input.timeout_ms === "number" ? input.timeout_ms : 30_000,
          context.signal,
        );
        return {
          content: [text(waited.completed.length === 0
            ? "No child agent completed before the timeout."
            : waited.completed.map(formatChild).join("\n"))],
          details: { timedOut: waited.timedOut, completed: waited.completed.map(jsonSnapshot) },
        };
      },
    },
    {
      name: "send_message",
      description: "Send a message to a direct continuable child, or from a resident child to its direct parent.",
      inputSchema: objectSchema({ agent_id: stringSchema("Direct child or parent agent id"), message: stringSchema("Message") }, ["agent_id", "message"]),
      classify: (_input, context) => action("send_message", "Send a message to a child agent", context.cwd),
      async execute(input, context) {
        const target = sessionId(requiredString(input, "agent_id"));
        const message = { ...userMessage(requiredString(input, "message")), id: messageId(randomUUID()), source: { kind: "agent-message", senderSessionId: context.sessionId } };
        if (service.sendMessage !== undefined) {
          const acceptedId = await service.sendMessage(context.sessionId, target, message);
          return { content: [text(`message delivered to agent ${target}`)], details: { messageId: acceptedId } };
        }
        const child = await service.send(context.sessionId, target, message);
        return { content: [text(`message delivered to agent ${target}`)], details: { messageId: message.id, child: jsonSnapshot(child) } };
      },
    },
    {
      name: "interrupt_agent",
      description: "Request cancellation of a direct or transitive descendant's current turn without deleting the agent.",
      inputSchema: objectSchema({ agent_id: stringSchema("Descendant agent id") }, ["agent_id"]),
      classify: (_input, context) => action("interrupt_agent", "Interrupt a descendant agent", context.cwd),
      async execute(input, context) {
        const id = sessionId(requiredString(input, "agent_id"));
        if (service.interrupt !== undefined) await service.interrupt(context.sessionId, id);
        else await service.abort(context.sessionId, id);
        return { content: [text(`interrupt requested for agent ${id}`)], details: { accepted: true } };
      },
    },
    {
      name: "abort_agent",
      description: "Legacy Seal alias for interrupt_agent.",
      inputSchema: objectSchema({ session_id: stringSchema("Child session id") }, ["session_id"]),
      classify: (_input, context) => action("abort_agent", "Abort a child agent", context.cwd),
      async execute(input, context) {
        const id = sessionId(requiredString(input, "session_id"));
        const aborted = await service.abort(context.sessionId, id);
        return { content: [text(aborted ? `Abort requested for ${id}` : `${id} is not running`)], details: { sessionId: id, aborted } };
      },
    },
  ];
}

function snapshot(session: SessionSnapshot, live: LiveChild | undefined, structuredResult?: JsonValue): SubagentSnapshot {
  const meta = metadata(session);
  const run = [...session.events].reverse().find(entry => entry.event.type === "run.started");
  const completion = [...session.events].reverse().find(entry => entry.event.type === "run.completed" && (run === undefined || entry.sequence > run.sequence));
  const status = live !== undefined ? "running" : completion?.event.type === "run.completed"
    ? completion.event.payload.outcome === "completed" ? "completed" : completion.event.payload.outcome
    : "failed";
  const messages = deriveSessionMessages(session);
  const lastAssistant = [...messages].reverse().find(message => message.role === "assistant");
  return {
    sessionId: session.id,
    parentSessionId: sessionId(String(meta[PARENT_KEY])),
    label: typeof meta[LABEL_KEY] === "string" ? meta[LABEL_KEY] : session.id,
    ...(typeof meta[TASK_KEY] === "string" ? { task: meta[TASK_KEY] } : {}),
    status,
    model: run?.event.type === "run.started" ? run.event.payload.model : latestModel(session),
    ...(run === undefined ? {} : { startedAt: run.timestamp }),
    ...(live !== undefined || completion === undefined ? {} : { finishedAt: completion.timestamp }),
    ...(live?.jobId === undefined ? {} : { jobId: live.jobId }),
    ...(lastAssistant === undefined ? {} : { result: messageText(lastAssistant) }),
    ...(structuredResult === undefined ? {} : { structuredResult }),
    ...(completion?.event.type === "run.completed" && completion.event.payload.error !== undefined
      ? { error: completion.event.payload.error }
      : {}),
  };
}

function metadata(session: SessionSnapshot): JsonObject {
  return creation(session).metadata ?? {};
}

function creation(session: SessionSnapshot) {
  const event = session.events.find(entry => entry.event.type === "session.created")?.event;
  if (event?.type !== "session.created") throw new Error(`session has no creation event: ${session.id}`);
  return event.payload;
}

function latestModel(session: SessionSnapshot): ModelRef {
  const event = [...session.events].reverse().find(entry => entry.event.type === "run.started")?.event;
  if (event?.type !== "run.started") throw new Error(`session has no model selection: ${session.id}`);
  return event.payload.model;
}

function messageText(message: AgentMessage): string {
  return message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
}

function formatChild(child: SubagentSnapshot): string {
  const suffix = child.error ?? child.result;
  return `${child.sessionId} · ${child.label} · ${child.status}${suffix ? `\n${suffix}` : ""}`;
}

function listAgentEntries(children: readonly SubagentSnapshot[], root: SessionId, scope: "children" | "descendants"): JsonObject[] {
  const parentById = new Map(children.map((child) => [child.sessionId, child.parentSessionId]));
  return children.map((child) => {
    let depth = 1; let parent = child.parentSessionId; const seen = new Set<SessionId>();
    while (parent !== root && parentById.has(parent) && !seen.has(parent)) { seen.add(parent); parent = parentById.get(parent)!; depth += 1; }
    return {
      kind: "child",
      id: child.sessionId,
      label: child.label,
      status: child.status === "running" ? "running" : "ready",
      ...(scope === "children" ? {} : { parent: child.parentSessionId, depth }),
    };
  });
}

function jsonSnapshot(child: SubagentSnapshot): JsonObject {
  return {
    sessionId: child.sessionId,
    parentSessionId: child.parentSessionId,
    label: child.label,
    status: child.status,
    model: { provider: child.model.provider, model: child.model.model },
    ...(child.jobId === undefined ? {} : { jobId: child.jobId }),
    ...(child.result === undefined ? {} : { result: child.result }),
    ...(child.structuredResult === undefined ? {} : { structuredResult: child.structuredResult }),
    ...(child.error === undefined ? {} : { error: child.error }),
  };
}

async function waitForOne(promises: readonly Promise<void>[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); resolve(); };
    const aborted = (): void => { clearTimeout(timer); reject(signal?.reason ?? new Error("wait aborted")); };
    timer = setTimeout(done, timeoutMs);
    signal?.addEventListener("abort", aborted, { once: true });
    for (const promise of promises) void promise.then(done, done);
  });
}

function action(toolName: string, summary: string, target: string) {
  return { kind: "tool" as const, toolName, risk: "read" as const, summary, target };
}

function objectSchema(properties: JsonObject, required: readonly string[]): JsonObject {
  return { type: "object", properties, required, additionalProperties: false };
}

function stringSchema(description: string): JsonObject {
  return { type: "string", minLength: 1, description };
}

function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}
