import { randomUUID } from "node:crypto";
import {
  GoalError,
  contextServiceToken,
  goalServiceToken,
  sessionStoreToken,
  text,
  toolServiceToken,
  type CreateGoalRequest,
  type EditGoalRequest,
  type GoalActivation,
  type GoalBlockReason,
  type GoalPhase,
  type GoalRef,
  type GoalService,
  type GoalSnapshot,
  type GoalView,
  type JsonObject,
  type JsonValue,
  type SealHarnessEvents,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type ToolDefinition,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface GoalToolsConfig {
  readonly defaultMaxGoalRounds?: number;
  readonly blockedAfterConsecutiveRounds?: number;
  readonly idFactory?: () => string;
  readonly now?: () => number;
}

const METADATA_KEY = "sealHarnessGoal";

export class SessionGoalService implements GoalService {
  readonly #activation = new Map<SessionId, GoalActivation>();
  readonly #queues = new Map<SessionId, Promise<void>>();

  constructor(
    readonly sessions: SessionStore,
    readonly defaultMaxGoalRounds = 256,
    readonly idFactory: () => string = randomUUID,
    readonly now: () => number = Date.now,
  ) {
    positive(defaultMaxGoalRounds, "defaultMaxGoalRounds");
  }

  async get(sessionId: SessionId): Promise<GoalView | undefined> {
    const snapshot = await this.snapshot(sessionId);
    return snapshot === undefined ? undefined : this.view(sessionId, snapshot);
  }

  create(sessionId: SessionId, request: CreateGoalRequest): Promise<GoalView> {
    return this.mutate(sessionId, async current => {
      if (current !== undefined && current.phase !== "complete") {
        throw new GoalError(`goal "${current.id}" already exists with phase "${current.phase}"`, "GOAL_ALREADY_EXISTS");
      }
      const timestamp = this.now();
      const goal: GoalSnapshot = {
        id: `goal-${this.idFactory()}`,
        revision: 1,
        objective: objective(request.objective),
        phase: "active",
        maxGoalRounds: positive(request.maxGoalRounds ?? this.defaultMaxGoalRounds, "maxGoalRounds"),
        roundsStarted: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return { goal, activation: "armed" };
    });
  }

  edit(sessionId: SessionId, ref: GoalRef, request: EditGoalRequest): Promise<GoalView> {
    if (request.objective === undefined && request.maxGoalRounds === undefined) {
      throw new GoalError("goal edit requires objective and/or maxGoalRounds", "GOAL_INVALID_EDIT");
    }
    return this.mutate(sessionId, async current => {
      const goal = exact(current, ref);
      return {
        goal: next(goal, this.now(), {
          ...(request.objective === undefined ? {} : { objective: objective(request.objective) }),
          ...(request.maxGoalRounds === undefined ? {} : { maxGoalRounds: positive(request.maxGoalRounds, "maxGoalRounds") }),
        }),
        activation: this.activation(sessionId),
      };
    });
  }

  pause(sessionId: SessionId, ref: GoalRef): Promise<GoalView> {
    return this.transition(sessionId, ref, "pause", ["active"], "paused", "disarmed");
  }

  resume(sessionId: SessionId, ref: GoalRef): Promise<GoalView> {
    return this.mutate(sessionId, async current => {
      const goal = exact(current, ref);
      if (!["active", "paused", "blocked"].includes(goal.phase)) transitionError(goal, "resume", ["active", "paused", "blocked"]);
      if (goal.phase === "active" && this.activation(sessionId) === "armed") {
        throw new GoalError(`goal "${goal.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");
      }
      if (goal.roundsStarted >= goal.maxGoalRounds) {
        throw new GoalError(`goal "${goal.id}" exhausted ${goal.maxGoalRounds} goal rounds`, "GOAL_INVALID_TRANSITION");
      }
      return { goal: next(goal, this.now(), { phase: "active" }, true), activation: "armed" };
    });
  }

  complete(sessionId: SessionId, ref: GoalRef): Promise<GoalView> {
    return this.transition(sessionId, ref, "complete", ["active", "paused", "blocked"], "complete", "disarmed");
  }

  clear(sessionId: SessionId, ref: GoalRef): Promise<GoalRef> {
    let resolve!: (value: GoalRef) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<GoalRef>((yes, no) => { resolve = yes; reject = no; });
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        const session = await requiredSession(this.sessions, sessionId);
        const current = exact(readGoal(session), ref);
        const tombstone = { id: current.id, revision: current.revision + 1 };
        await appendGoal(this.sessions, sessionId, null);
        this.#activation.set(sessionId, "disarmed");
        resolve(tombstone);
      } catch (error) { reject(error); }
    });
    this.#queues.set(sessionId, queued);
    void queued.finally(() => { if (this.#queues.get(sessionId) === queued) this.#queues.delete(sessionId); });
    return result;
  }

  block(sessionId: SessionId, ref: GoalRef, reason: GoalBlockReason): Promise<GoalView> {
    const resolved = blockReason(reason);
    return this.mutate(sessionId, async current => {
      const goal = exact(current, ref);
      if (goal.phase !== "active") transitionError(goal, "block", ["active"]);
      return { goal: next(goal, this.now(), { phase: "blocked", blockedReason: resolved }), activation: "disarmed" };
    });
  }

  startRound(sessionId: SessionId, ref: GoalRef): Promise<GoalView> {
    return this.mutate(sessionId, async current => {
      const goal = exact(current, ref);
      if (goal.phase !== "active" || this.activation(sessionId) !== "armed") {
        throw new GoalError(`goal "${goal.id}" is not active and armed`, "GOAL_INVALID_TRANSITION");
      }
      if (goal.roundsStarted >= goal.maxGoalRounds) {
        throw new GoalError(`goal "${goal.id}" exhausted ${goal.maxGoalRounds} goal rounds`, "GOAL_INVALID_TRANSITION");
      }
      return { goal: { ...goal, roundsStarted: goal.roundsStarted + 1, updatedAt: this.now() }, activation: "armed" };
    });
  }

  async disarm(sessionId: SessionId): Promise<GoalView | undefined> {
    const goal = await this.snapshot(sessionId);
    this.#activation.set(sessionId, "disarmed");
    return goal === undefined ? undefined : this.view(sessionId, goal);
  }

  private transition(sessionId: SessionId, ref: GoalRef, operation: string, allowed: GoalPhase[], phase: GoalPhase, activation: GoalActivation): Promise<GoalView> {
    return this.mutate(sessionId, async current => {
      const goal = exact(current, ref);
      if (!allowed.includes(goal.phase)) transitionError(goal, operation, allowed);
      return { goal: next(goal, this.now(), { phase }, true), activation };
    });
  }

  private mutate(sessionId: SessionId, change: (current: GoalSnapshot | undefined) => Promise<{ goal: GoalSnapshot; activation: GoalActivation }>): Promise<GoalView> {
    let resolve!: (view: GoalView) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<GoalView>((yes, no) => { resolve = yes; reject = no; });
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        const session = await requiredSession(this.sessions, sessionId);
        const changed = await change(readGoal(session));
        await appendGoal(this.sessions, sessionId, changed.goal);
        this.#activation.set(sessionId, changed.activation);
        resolve(this.view(sessionId, changed.goal));
      } catch (error) { reject(error); }
    });
    this.#queues.set(sessionId, queued);
    void queued.finally(() => { if (this.#queues.get(sessionId) === queued) this.#queues.delete(sessionId); });
    return result;
  }

  private async snapshot(sessionId: SessionId): Promise<GoalSnapshot | undefined> {
    return readGoal(await requiredSession(this.sessions, sessionId));
  }

  private activation(sessionId: SessionId): GoalActivation { return this.#activation.get(sessionId) ?? "disarmed"; }
  private view(sessionId: SessionId, goal: GoalSnapshot): GoalView { return { ...goal, activation: this.activation(sessionId) }; }
}

export const goalToolsPlugin = definePlugin<GoalToolsConfig, SealHarnessEvents>({
  name: "goal-tools",
  provides: [goalServiceToken],
  requires: [sessionStoreToken, toolServiceToken, contextServiceToken],
  setup(context, config) {
    const blockedAfter = positive(config.blockedAfterConsecutiveRounds ?? 3, "blockedAfterConsecutiveRounds");
    const service = new SessionGoalService(
      context.use(sessionStoreToken),
      positive(config.defaultMaxGoalRounds ?? 256, "defaultMaxGoalRounds"),
      config.idFactory ?? randomUUID,
      config.now ?? Date.now,
    );
    context.provide(goalServiceToken, service);
    context.effect(context.use(contextServiceToken).register({
      name: "goal-tools-guidance",
      async contribute() {
        return { systemPrompt: goalGuidance(blockedAfter) };
      },
    }));
    for (const tool of goalTools(service, context.use(sessionStoreToken))) context.effect(context.use(toolServiceToken).register(tool));
  },
});

function goalTools(service: GoalService, sessions: SessionStore): ToolDefinition[] {
  return [
    {
      name: "get_goal",
      description: "Read the current same-session goal, including its exact id/revision, lifecycle phase, round limit, and activation.",
      inputSchema: objectSchema({}, []),
      classify: (_input, context) => action("get_goal", "Read current goal", context.cwd),
      async execute(_input, context) { return output(await service.get(context.sessionId)); },
    },
    {
      name: "create_goal",
      description: "Create one persisted same-session completion goal for a long-running objective.",
      inputSchema: objectSchema({
        objective: { type: "string", minLength: 1 },
        max_goal_rounds: { type: "integer", minimum: 1 },
      }, ["objective"]),
      classify: (_input, context) => action("create_goal", "Create goal", context.cwd, "workspace-write"),
      async execute(input, context) {
        await requireDirectHuman(sessions, context.sessionId);
        return output(await service.create(context.sessionId, {
          objective: requiredString(input, "objective"),
          ...(typeof input.max_goal_rounds === "number" ? { maxGoalRounds: input.max_goal_rounds } : {}),
        }));
      },
    },
    {
      name: "update_goal",
      description: "Update the exact current goal revision with edit, pause, resume, complete, or blocked.",
      inputSchema: objectSchema({
        goal_id: { type: "string", minLength: 1 }, revision: { type: "integer", minimum: 1 },
        action: { type: "string", enum: ["edit", "pause", "resume", "complete", "blocked"] },
        objective: { type: "string", minLength: 1 }, max_goal_rounds: { type: "integer", minimum: 1 },
        blocked_reason: { type: "string", minLength: 1 },
      }, ["goal_id", "revision", "action"]),
      classify: (_input, context) => action("update_goal", "Update goal", context.cwd, "workspace-write"),
      async execute(input, context) {
        const ref = goalRef(input);
        const operation = requiredString(input, "action");
        assertUpdateFields(input, operation);
        if (operation === "edit" || operation === "pause" || operation === "resume") await requireDirectHuman(sessions, context.sessionId);
        if (operation === "edit") return output(await service.edit(context.sessionId, ref, {
          ...(typeof input.objective === "string" ? { objective: input.objective } : {}),
          ...(typeof input.max_goal_rounds === "number" ? { maxGoalRounds: input.max_goal_rounds } : {}),
        }));
        if (operation === "pause") return output(await service.pause(context.sessionId, ref));
        if (operation === "resume") return output(await service.resume(context.sessionId, ref));
        if (operation === "complete") return output(await service.complete(context.sessionId, ref));
        return output(await service.block(context.sessionId, ref, { code: "model-reported", message: requiredString(input, "blocked_reason") }));
      },
    },
  ];
}

function goalGuidance(blockedAfter: number): string {
  return "Use goal tools for one long-running completion objective in the current Session. Call get_goal before update_goal and copy its exact goal_id and revision. "
    + "After Session resume or fork an active goal is disarmed; resume it only after a human asks to continue. Mark complete only when achieved. "
    + `Mark blocked only after the same condition persists for at least ${blockedAfter} consecutive goal rounds.`;
}

async function appendGoal(sessions: SessionStore, sessionId: SessionId, goal: GoalSnapshot | null): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const session = await requiredSession(sessions, sessionId);
    try {
      await sessions.append({ id: sessionId, expectedVersion: session.version, events: [{ type: "session.metadata", payload: { patch: { [METADATA_KEY]: goal === null ? null : goalJson(goal) } } }] });
      return;
    } catch (error) {
      if (attempt === 7 || !(error instanceof Error) || error.name !== "SessionConflictError") throw error;
    }
  }
}

function readGoal(session: SessionSnapshot): GoalSnapshot | undefined {
  let raw: JsonValue | undefined;
  for (const stored of session.events) {
    if (stored.event.type === "session.created") raw = stored.event.payload.metadata?.[METADATA_KEY];
    if (stored.event.type === "session.metadata" && METADATA_KEY in stored.event.payload.patch) raw = stored.event.payload.patch[METADATA_KEY];
  }
  return raw === undefined || raw === null ? undefined : parseGoal(raw);
}

function parseGoal(raw: JsonValue): GoalSnapshot {
  if (!record(raw)) throw new GoalError("persisted goal is invalid", "GOAL_INVALID_LOG");
  const phase = raw.phase;
  if (phase !== "active" && phase !== "paused" && phase !== "blocked" && phase !== "complete") throw new GoalError("persisted goal phase is invalid", "GOAL_INVALID_LOG");
  const base: GoalSnapshot = {
    id: string(raw.id, "id"), revision: integer(raw.revision, "revision"), objective: string(raw.objective, "objective"), phase,
    maxGoalRounds: integer(raw.maxGoalRounds, "maxGoalRounds"), roundsStarted: nonNegative(raw.roundsStarted, "roundsStarted"),
    createdAt: nonNegative(raw.createdAt, "createdAt"), updatedAt: nonNegative(raw.updatedAt, "updatedAt"),
  };
  if (raw.blockedReason === undefined) return base;
  if (!record(raw.blockedReason)) throw new GoalError("persisted blocked reason is invalid", "GOAL_INVALID_LOG");
  return { ...base, blockedReason: blockReason({ code: string(raw.blockedReason.code, "code"), message: string(raw.blockedReason.message, "message") }) };
}

function goalJson(goal: GoalSnapshot): JsonObject { return {
  id: goal.id, revision: goal.revision, objective: goal.objective, phase: goal.phase,
  maxGoalRounds: goal.maxGoalRounds, roundsStarted: goal.roundsStarted,
  createdAt: goal.createdAt, updatedAt: goal.updatedAt,
  ...(goal.blockedReason === undefined ? {} : { blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message } }),
}; }
function output(goal: GoalView | undefined) { const value = goal === undefined ? { goal: null } : { goal: goalJson(goal), activation: goal.activation }; return { content: [text(JSON.stringify(value))], details: value }; }
function next(goal: GoalSnapshot, updatedAt: number, patch: Partial<GoalSnapshot>, clearBlocked = false): GoalSnapshot { const merged = { ...goal, ...patch, revision: goal.revision + 1, updatedAt }; if (clearBlocked) delete (merged as { blockedReason?: GoalBlockReason }).blockedReason; return merged; }
function exact(current: GoalSnapshot | undefined, ref: GoalRef): GoalSnapshot { if (current === undefined) throw new GoalError("no current goal", "GOAL_NOT_FOUND"); if (current.id !== ref.id || current.revision !== ref.revision) throw new GoalError(`stale goal revision; current is ${current.id}@${current.revision}`, "GOAL_REVISION_CONFLICT"); return current; }
function transitionError(goal: GoalSnapshot, operation: string, phases: GoalPhase[]): never { throw new GoalError(`goal "${goal.id}" cannot ${operation} from "${goal.phase}"; expected ${phases.join(" or ")}`, "GOAL_INVALID_TRANSITION"); }
function objective(value: string): string { const result = value.trim(); if (!result) throw new GoalError("goal objective must be non-empty", "GOAL_INVALID_OBJECTIVE"); return result; }
function blockReason(reason: GoalBlockReason): GoalBlockReason { const message = reason.message.trim(); if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(reason.code) || !message) throw new GoalError("goal block reason is invalid", "GOAL_INVALID_BLOCK_REASON"); return { code: reason.code, message }; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new GoalError(`${name} must be a positive safe integer`, "GOAL_INVALID_MAX_ROUNDS"); return value; }
function nonNegative(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new GoalError(`${name} is invalid`, "GOAL_INVALID_LOG"); return value; }
function integer(value: unknown, name: string): number { if (typeof value !== "number") throw new GoalError(`${name} is invalid`, "GOAL_INVALID_LOG"); return positive(value, name); }
function string(value: unknown, name: string): string { if (typeof value !== "string" || !value) throw new GoalError(`${name} is invalid`, "GOAL_INVALID_LOG"); return value; }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function requiredSession(sessions: SessionStore, id: SessionId): Promise<SessionSnapshot> { const session = await sessions.read(id); if (session === undefined) throw new GoalError(`Session not found: ${id}`, "GOAL_SESSION_NOT_FOUND"); return session; }
export async function requireDirectHuman(sessions: SessionStore, id: SessionId): Promise<void> {
  const session = await requiredSession(sessions, id);
  const startedIndex = session.events.findLastIndex(({ event }) => event.type === "run.started");
  if (startedIndex < 0) throw new GoalError("goal mutation requires a direct human request", "GOAL_TOOL_REQUIRES_HUMAN");
  const prompt = session.events.slice(0, startedIndex).findLast(({ event }) => event.type === "message.appended" && event.payload.message.role === "user");
  const promptMessage = prompt?.event.type === "message.appended" ? prompt.event.payload.message : undefined;
  const kind = promptMessage?.role === "user" ? promptMessage.source?.kind : undefined;
  if (typeof kind !== "string" || (kind !== "user" && !kind.startsWith("user-"))) {
    throw new GoalError("goal mutation requires a direct human request", "GOAL_TOOL_REQUIRES_HUMAN");
  }
}
function goalRef(input: JsonObject): GoalRef { return { id: requiredString(input, "goal_id"), revision: typeof input.revision === "number" ? positive(input.revision, "revision") : 0 }; }
function requiredString(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string" || value.trim().length === 0) throw new GoalError(`${key} must be non-empty`, "GOAL_TOOL_INVALID_UPDATE"); return value; }
function assertUpdateFields(input: JsonObject, operation: string): void { const edit = input.objective !== undefined || input.max_goal_rounds !== undefined; const blocked = input.blocked_reason !== undefined; if (operation === "edit" && !edit) throw new GoalError("edit requires objective and/or max_goal_rounds", "GOAL_TOOL_INVALID_UPDATE"); if (operation !== "edit" && edit) throw new GoalError("objective and max_goal_rounds are valid only with edit", "GOAL_TOOL_INVALID_UPDATE"); if (operation === "blocked" && !blocked) throw new GoalError("blocked_reason is required with blocked", "GOAL_TOOL_INVALID_UPDATE"); if (operation !== "blocked" && blocked) throw new GoalError("blocked_reason is valid only with blocked", "GOAL_TOOL_INVALID_UPDATE"); }
function objectSchema(properties: JsonObject, required: readonly string[]): JsonObject { return { type: "object", properties, required, additionalProperties: false }; }
function action(toolName: string, summary: string, target: string, risk: "read" | "workspace-write" = "read") { return { kind: "tool" as const, toolName, risk, summary, target }; }
