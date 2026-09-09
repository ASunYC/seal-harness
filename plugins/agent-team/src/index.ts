import { randomUUID } from "node:crypto";
import {
  agentServiceToken, messageId, SessionConflictError, sessionId, sessionStoreToken,
  subagentServiceToken, teamServiceToken, text,
  type AgentService, type ContentBlock, type CreateTeamTaskRequest, type JsonObject,
  type SealHarnessEvents, type SendTeamMessageRequest, type SessionEvent, type SessionId,
  type SessionSnapshot, type SessionStore, type SpawnTeammateRequest, type SubagentService,
  type TeamMemberView, type TeamService, type TeamTaskView, type TeamView, type UpdateTeamTaskRequest,
  TeamError,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

const PARENT_KEY = "sealHarness.parentSessionId";
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AgentTeamConfig {
  readonly maxMembers?: number;
  readonly maxTasks?: number;
  readonly maxPendingMessagesPerMember?: number;
  readonly maxMessageBytes?: number;
  readonly idFactory?: () => string;
}

interface Projection {
  readonly members: Map<string, Extract<SessionEvent, { type: "team/member" }>["payload"]>;
  readonly tasks: Map<string, Extract<SessionEvent, { type: "team/task" }>["payload"]["task"]>;
  readonly queued: Map<string, Extract<SessionEvent, { type: "team/message/queued" }>["payload"]>;
  readonly delivered: Set<string>;
}

export class DurableAgentTeamService implements TeamService {
  readonly #chains = new Map<SessionId, Promise<unknown>>();
  readonly #listeners = new Map<SessionId, Set<() => void>>();
  readonly maxMembers: number; readonly maxTasks: number; readonly maxPending: number; readonly maxBytes: number;
  constructor(readonly sessions: SessionStore, readonly subagents: SubagentService, readonly agents: AgentService, config: AgentTeamConfig = {}) {
    this.maxMembers = positive(config.maxMembers ?? 8, "maxMembers");
    this.maxTasks = positive(config.maxTasks ?? 256, "maxTasks");
    this.maxPending = positive(config.maxPendingMessagesPerMember ?? 64, "maxPendingMessagesPerMember");
    this.maxBytes = positive(config.maxMessageBytes ?? 65_536, "maxMessageBytes");
    this.idFactory = config.idFactory ?? randomUUID;
  }
  readonly idFactory: () => string;

  async recover(): Promise<void> {
    for (const snapshot of await this.sessions.list()) {
      if (typeof creation(snapshot).metadata?.[PARENT_KEY] === "string") continue;
      const state = project(snapshot);
      for (const member of state.members.values()) {
        if (member.state !== "provisioning") continue;
        const child = await this.sessions.read(member.memberId); const matches = child !== undefined && creation(child).metadata?.[PARENT_KEY] === snapshot.id;
        await this.append(snapshot.id, { type: "team/member", payload: { ...member, state: matches ? "active" : "failed", ...(matches ? {} : { diagnostic: "provisioning did not leave a resumable child Session" }) } });
      }
      const refreshed = project(await this.requireSession(snapshot.id));
      for (const queued of refreshed.queued.values()) {
        if (refreshed.delivered.has(queued.messageId)) continue;
        const senderId = queued.from === "lead" ? snapshot.id : refreshed.members.get(queued.from)?.memberId;
        const targetId = queued.to === "lead" ? snapshot.id : refreshed.members.get(queued.to)?.memberId;
        if (senderId === undefined || targetId === undefined) continue;
        await this.deliver(snapshot.id, senderId, targetId, queued.messageId, queued.from, queued.content).catch(() => false);
      }
    }
  }

  async notifySessionChanged(session: SessionId): Promise<void> {
    const snapshot = await this.sessions.read(session); if (snapshot === undefined) return;
    const parent = creation(snapshot).metadata?.[PARENT_KEY]; this.publish(typeof parent === "string" ? sessionId(parent) : session);
  }

  async view(caller: SessionId): Promise<TeamView> {
    const membership = await this.membership(caller); return { id: membership.teamId, caller: membership.name, members: await this.listMembers(caller), tasks: await this.listTasks(caller) };
  }

  async spawnTeammate(caller: SessionId, request: SpawnTeammateRequest): Promise<TeamMemberView> {
    const membership = await this.membership(caller); if (membership.role !== "lead") throw new TeamError("Only the Team Lead can create teammates", "TEAM_LEAD_REQUIRED");
    const name = request.name; if (!NAME.test(name) || name.length > 64 || name === "lead") throw new TeamError("teammate name must be lower-kebab-case, at most 64 characters, and not lead", "TEAM_INVALID_MEMBER_NAME");
    return this.serial(membership.teamId, async () => {
      request.signal?.throwIfAborted(); const snapshot = await this.requireSession(membership.teamId); const state = project(snapshot);
      if (state.members.has(name)) throw new TeamError(`Team member name is already reserved: ${name}`, "TEAM_MEMBER_EXISTS");
      if (state.members.size >= this.maxMembers) throw new TeamError(`Team member limit reached (${this.maxMembers})`, "TEAM_MEMBER_LIMIT");
      const childId = sessionId(`team-${this.idFactory()}`); const context = request.context ?? "fresh";
      const base = { teamId: membership.teamId, memberId: childId, name, description: required(request.description, "description", 200), context, ...(request.model === undefined ? {} : { model: request.model }) };
      await this.append(membership.teamId, { type: "team/member", payload: { ...base, state: "provisioning" } }); this.publish(membership.teamId);
      try {
        await this.subagents.spawn({ sessionId: childId, parentSessionId: membership.teamId, cwd: creation(snapshot).cwd, prompt: contentText(request.prompt), label: name, ...(request.model === undefined ? {} : { model: request.model }), inheritParentContext: context === "fork" });
        await this.append(membership.teamId, { type: "team/member", payload: { ...base, state: "active" } }); this.publish(membership.teamId);
      } catch (error) {
        await this.append(membership.teamId, { type: "team/member", payload: { ...base, state: "failed", diagnostic: errorMessage(error) } }); this.publish(membership.teamId); throw error;
      }
      return (await this.listMembers(caller)).find(member => member.name === name)!;
    });
  }

  async sendMessage(caller: SessionId, request: SendTeamMessageRequest): Promise<{ messageId: string; status: "accepted" | "queued" }> {
    const membership = await this.membership(caller); request.signal?.throwIfAborted(); const targetName = request.target.trim();
    return this.serial(membership.teamId, async () => {
      const snapshot = await this.requireSession(membership.teamId); const state = project(snapshot); const target = targetName === "lead" ? { id: membership.teamId, name: "lead" } : memberByName(state, targetName);
      if (target.id === caller) throw new TeamError("Cannot send a Team message to yourself", "TEAM_MESSAGE_SELF");
      const bytes = Buffer.byteLength(`Team message from ${membership.name}:`) + Buffer.byteLength(JSON.stringify(request.content)); if (bytes > this.maxBytes) throw new TeamError(`Team message exceeds ${this.maxBytes} bytes`, "TEAM_MESSAGE_LIMIT");
      const pending = [...state.queued.values()].filter(row => row.to === target.name && !state.delivered.has(row.messageId)).length;
      if (pending >= this.maxPending) throw new TeamError(`Pending Team message limit reached for ${target.name}`, "TEAM_MAILBOX_LIMIT");
      const id = `team-message-${this.idFactory()}`; await this.append(membership.teamId, { type: "team/message/queued", payload: { teamId: membership.teamId, messageId: id, from: membership.name, to: target.name, content: request.content } }); this.publish(membership.teamId);
      const accepted = await this.deliver(membership.teamId, caller, target.id, id, membership.name, request.content).catch(() => false);
      return { messageId: id, status: accepted ? "accepted" : "queued" };
    });
  }

  async listMembers(caller: SessionId): Promise<readonly TeamMemberView[]> {
    const membership = await this.membership(caller); const lead = await this.requireSession(membership.teamId); const state = project(lead); const children = await this.subagents.list(membership.teamId); const byId = new Map(children.map(row => [row.sessionId, row]));
    const leadActive = this.agents.active?.(membership.teamId) !== undefined;
    const members: TeamMemberView[] = [{ id: membership.teamId, name: "lead", role: "lead", status: leadActive ? "running" : "idle", diagnostics: [] }];
    for (const row of state.members.values()) { const child = byId.get(row.memberId); members.push({ id: row.memberId, name: row.name, role: "teammate", status: row.state === "failed" ? "failed" : row.state === "provisioning" ? "provisioning" : child?.status === "running" ? "running" : "inactive", description: row.description, context: row.context, ...(row.model === undefined ? child?.model === undefined ? {} : { model: child.model } : { model: row.model }), diagnostics: row.diagnostic === undefined ? [] : [row.diagnostic] }); }
    return members;
  }

  async waitForChange(caller: SessionId, timeoutMs: number, signal?: AbortSignal): Promise<{ timedOut: boolean }> {
    const { teamId } = await this.membership(caller); if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) throw new TeamError("timeout must be from 10000 through 3600000 milliseconds", "TEAM_WAIT_INVALID");
    if (signal?.aborted) throw signal.reason; return new Promise((resolve, reject) => { const listeners = this.#listeners.get(teamId) ?? new Set(); this.#listeners.set(teamId, listeners); let timer: ReturnType<typeof setTimeout>; const finish = (timedOut: boolean) => { clearTimeout(timer); listeners.delete(changed); signal?.removeEventListener("abort", aborted); resolve({ timedOut }); }; const changed = () => finish(false); const aborted = () => { clearTimeout(timer); listeners.delete(changed); reject(signal?.reason ?? new TeamError("Team wait aborted", "TEAM_WAIT_ABORTED")); }; listeners.add(changed); timer = setTimeout(() => finish(true), timeoutMs); signal?.addEventListener("abort", aborted, { once: true }); });
  }

  async interrupt(caller: SessionId, targetName: string): Promise<{ previousStatus: "running" | "idle" | "inactive" }> {
    const membership = await this.membership(caller); if (membership.role !== "lead") throw new TeamError("Only the Team Lead can interrupt teammates", "TEAM_LEAD_REQUIRED"); const members = await this.listMembers(caller); const target = members.find(row => row.name === targetName && row.role === "teammate"); if (target === undefined) throw new TeamError(`Unknown teammate: ${targetName}`, "TEAM_MEMBER_NOT_FOUND"); const previousStatus = target.status === "running" ? "running" : target.status === "inactive" ? "inactive" : "idle"; await this.subagents.interrupt?.(membership.teamId, target.id, new Error("Interrupted by Team Lead")); this.publish(membership.teamId); return { previousStatus };
  }

  async createTask(caller: SessionId, request: CreateTeamTaskRequest): Promise<TeamTaskView> { const membership = await this.membership(caller); return this.serial(membership.teamId, async () => { const state = project(await this.requireSession(membership.teamId)); const active = [...state.tasks.values()].filter(task => task.status !== "deleted"); if (active.length >= this.maxTasks) throw new TeamError(`Team task limit reached (${this.maxTasks})`, "TEAM_TASK_LIMIT"); const max = [...state.tasks.keys()].reduce((value, id) => Math.max(value, Number(/^task-(\d+)$/.exec(id)?.[1] ?? 0)), 0); if (!Number.isSafeInteger(max + 1)) throw new TeamError("Team task id space exhausted", "TEAM_TASK_LIMIT"); const task = taskRecord(`task-${max + 1}`, 1, request.subject, request.description, dependencies(request.blockedBy ?? [], state.tasks), request.writeScopes ?? []); assertTaskGraph(state.tasks, task); await this.append(membership.teamId, { type: "team/task", payload: { teamId: membership.teamId, task } }); this.publish(membership.teamId); return taskView(task, new Map(state.tasks).set(task.id, task)); }); }
  async listTasks(caller: SessionId): Promise<readonly TeamTaskView[]> { const { teamId } = await this.membership(caller); const state = project(await this.requireSession(teamId)); return [...state.tasks.values()].filter(task => task.status !== "deleted").map(task => taskView(task, state.tasks)); }
  async getTask(caller: SessionId, taskId: string): Promise<TeamTaskView> { const tasks = await this.listTasks(caller); const task = tasks.find(row => row.id === taskId); if (task === undefined) throw new TeamError(`Unknown Team task: ${taskId}`, "TEAM_TASK_NOT_FOUND"); return task; }

  async updateTask(caller: SessionId, request: UpdateTeamTaskRequest): Promise<TeamTaskView> { const membership = await this.membership(caller); return this.serial(membership.teamId, async () => { const state = project(await this.requireSession(membership.teamId)); const current = state.tasks.get(request.taskId); if (current === undefined || current.status === "deleted") throw new TeamError(`Unknown Team task: ${request.taskId}`, "TEAM_TASK_NOT_FOUND"); if (current.revision !== request.expectedRevision) throw new TeamError(`Team task revision is stale; expected ${current.revision}`, "TEAM_TASK_STALE_REVISION"); let next = { ...current, revision: current.revision + 1 };
      const authorizeOwner = (): void => { if (membership.role !== "lead" && current.ownerName !== membership.name) throw new TeamError("Task mutation requires its owner or Team Lead", "TEAM_TASK_UNAUTHORIZED"); };
      switch (request.action) {
        case "claim": if (current.ownerName !== undefined && current.ownerName !== membership.name) throw new TeamError("Task is owned by another member", "TEAM_TASK_ALREADY_CLAIMED"); if (current.status !== "pending" || !taskView(current, state.tasks).ready) throw new TeamError("Task is not ready to claim", "TEAM_TASK_BLOCKED"); next = { ...next, status: "in_progress", ownerName: membership.name }; break;
        case "release": authorizeOwner(); if (current.status !== "in_progress") throw new TeamError("Only an in-progress task can be released", "TEAM_TASK_INVALID_TRANSITION"); next = withoutOwner({ ...next, status: "pending" as const }); break;
        case "complete": authorizeOwner(); if (current.status !== "in_progress") throw new TeamError("Only an in-progress task can complete", "TEAM_TASK_INVALID_TRANSITION"); next = { ...next, status: "completed" }; break;
        case "reopen": authorizeOwner(); if (current.status !== "completed") throw new TeamError("Only a completed task can be reopened", "TEAM_TASK_INVALID_TRANSITION"); next = withoutOwner({ ...next, status: "pending" as const }); break;
        case "delete": authorizeOwner(); { const dependent = [...state.tasks.values()].find(task => task.status !== "deleted" && task.id !== current.id && task.blockedBy.includes(current.id)); if (dependent !== undefined) throw new TeamError(`Task still blocks ${dependent.id}`, "TEAM_TASK_HAS_DEPENDENTS"); } next = { ...next, status: "deleted" }; break;
        case "edit": authorizeOwner(); if (request.subject === undefined && request.description === undefined && request.writeScopes === undefined) throw new TeamError("Task edit requires subject, description, or write_scopes", "TEAM_INVALID_ARGUMENT"); next = { ...next, ...(request.subject === undefined ? {} : { subject: required(request.subject, "subject", 200) }), ...(request.description === undefined ? {} : { description: required(request.description, "description", 16_384) }), ...(request.writeScopes === undefined ? {} : { writeScopes: scopes(request.writeScopes) }) }; break;
        case "set_dependencies": authorizeOwner(); if (request.blockedBy === undefined) throw new TeamError("set_dependencies requires blocked_by", "TEAM_INVALID_ARGUMENT"); next = { ...next, blockedBy: dependencies(request.blockedBy, state.tasks, current.id) }; break;
        case "reassign": if (membership.role !== "lead") throw new TeamError("Only the Team Lead can reassign tasks", "TEAM_LEAD_REQUIRED"); if (current.status !== "pending" && current.status !== "in_progress") throw new TeamError("Only pending or in-progress tasks can be reassigned", "TEAM_TASK_INVALID_TRANSITION"); if (request.owner === undefined || request.owner.trim() === "") next = withoutOwner({ ...next, status: "pending" as const }); else { if (!dependenciesComplete(current, state.tasks)) throw new TeamError("Task is blocked", "TEAM_TASK_BLOCKED"); memberByName(state, request.owner); next = { ...next, ownerName: request.owner, status: "in_progress" }; } break;
      }
      assertTaskGraph(state.tasks, next); await this.append(membership.teamId, { type: "team/task", payload: { teamId: membership.teamId, task: next } }); this.publish(membership.teamId); return taskView(next, new Map(state.tasks).set(next.id, next)); }); }

  private async membership(caller: SessionId): Promise<{ teamId: SessionId; name: string; role: "lead" | "teammate" }> { const session = await this.requireSession(caller); const parent = creation(session).metadata?.[PARENT_KEY]; if (typeof parent !== "string") return { teamId: caller, name: "lead", role: "lead" }; const teamId = sessionId(parent); const state = project(await this.requireSession(teamId)); const member = [...state.members.values()].find(row => row.memberId === caller && row.state === "active"); if (member === undefined) throw new TeamError(`Session is not an active Team member: ${caller}`, "TEAM_MEMBER_NOT_FOUND"); return { teamId, name: member.name, role: "teammate" }; }
  private async deliver(teamId: SessionId, senderId: SessionId, targetId: SessionId, id: string, from: string, content: readonly ContentBlock[]): Promise<boolean> { const target = await this.requireSession(targetId); const accepted = target.events.some(({ event }) => event.type === "message.appended" ? event.payload.message.role === "user" && event.payload.message.id === id : event.type === "agent/inbox.spliced" && event.payload.inserted.some(message => message.id === id)); const message = { role: "user" as const, content: [text(`Team message ${id} from ${from}:`), ...content], id: messageId(id), source: { kind: "agent-message" as const, senderSessionId: senderId } }; if (!accepted) { if (targetId === teamId) { if (this.subagents.sendMessage === undefined) throw new TeamError("Subagent service cannot deliver child-to-Lead messages", "TEAM_DELIVERY_UNAVAILABLE"); await this.subagents.sendMessage(senderId, targetId, message); } else if (senderId === teamId && this.subagents.sendMessage !== undefined) await this.subagents.sendMessage(senderId, targetId, message); else await this.subagents.send(teamId, targetId, message); } await this.append(teamId, { type: "team/message/delivered", payload: { teamId, messageId: id } }); this.publish(teamId); return true; }
  private async append(id: SessionId, event: SessionEvent): Promise<void> { for (let attempt = 0; attempt < 8; attempt++) { const current = await this.requireSession(id); try { await this.sessions.append({ id, expectedVersion: current.version, events: [event] }); return; } catch (error) { if (!(error instanceof SessionConflictError) || attempt === 7) throw error; } } }
  private serial<T>(id: SessionId, operation: () => Promise<T>): Promise<T> { const prior = this.#chains.get(id) ?? Promise.resolve(); const result = prior.catch(() => {}).then(operation); this.#chains.set(id, result); void result.finally(() => { if (this.#chains.get(id) === result) this.#chains.delete(id); }).catch(() => {}); return result; }
  private publish(id: SessionId): void { for (const listener of this.#listeners.get(id) ?? []) listener(); }
  private async requireSession(id: SessionId): Promise<SessionSnapshot> { const session = await this.sessions.read(id); if (session === undefined) throw new TeamError(`Session not found: ${id}`, "TEAM_SESSION_NOT_FOUND"); return session; }
}

function project(session: SessionSnapshot): Projection { const members = new Map(), tasks = new Map(), queued = new Map(), delivered = new Set<string>(); for (const { event } of session.events) { if (event.type === "team/member") members.set(event.payload.name, event.payload); else if (event.type === "team/task") tasks.set(event.payload.task.id, event.payload.task); else if (event.type === "team/message/queued") queued.set(event.payload.messageId, event.payload); else if (event.type === "team/message/delivered") delivered.add(event.payload.messageId); } return { members, tasks, queued, delivered }; }
function creation(session: SessionSnapshot) { const event = session.events.find(row => row.event.type === "session.created")?.event; if (event?.type !== "session.created") throw new TeamError(`Session has no creation event: ${session.id}`, "TEAM_SESSION_INVALID"); return event.payload; }
function memberByName(state: Projection, name: string) { const row = state.members.get(name); if (row === undefined || row.state !== "active") throw new TeamError(`Unknown active teammate: ${name}`, "TEAM_MEMBER_NOT_FOUND"); return { id: row.memberId, name: row.name }; }
function taskRecord(id: string, revision: number, subject: string, description: string, blockedBy: readonly string[], writeScopes: readonly string[]): Extract<SessionEvent, { type: "team/task" }>["payload"]["task"] { return { id, revision, subject: required(subject, "subject", 200), description: required(description, "description", 16_384), status: "pending", blockedBy: [...blockedBy], writeScopes: scopes(writeScopes) }; }
function dependenciesComplete(task: Extract<SessionEvent, { type: "team/task" }>["payload"]["task"], tasks: Map<string, Extract<SessionEvent, { type: "team/task" }>["payload"]["task"]>): boolean { return task.blockedBy.every(id => tasks.get(id)?.status === "completed"); }
function taskView(task: Extract<SessionEvent, { type: "team/task" }>["payload"]["task"], tasks: Map<string, Extract<SessionEvent, { type: "team/task" }>["payload"]["task"]>): TeamTaskView { const ready = task.status === "pending" && dependenciesComplete(task, tasks); const warnings: string[] = []; if (task.status === "in_progress") for (const other of tasks.values()) if (other.id !== task.id && other.status === "in_progress" && task.writeScopes.some(a => other.writeScopes.some(b => overlaps(a, b)))) warnings.push(`write scope overlaps ${other.id}`); return { ...task, ready, writeScopeWarnings: warnings }; }
function assertTaskGraph(tasks: Map<string, Extract<SessionEvent, { type: "team/task" }>["payload"]["task"]>, candidate: Extract<SessionEvent, { type: "team/task" }>["payload"]["task"]): void { const all = new Map(tasks).set(candidate.id, candidate); for (const dependency of candidate.blockedBy) if (!all.has(dependency) || dependency === candidate.id) throw new TeamError(`Invalid task dependency: ${dependency}`, "TEAM_TASK_DEPENDENCY"); const visit = (id: string, path: Set<string>): void => { if (path.has(id)) throw new TeamError("Team task dependencies contain a cycle", "TEAM_TASK_CYCLE"); const next = new Set(path).add(id); for (const dep of all.get(id)?.blockedBy ?? []) visit(dep, next); }; visit(candidate.id, new Set()); }
function dependencies(values: readonly string[], tasks: Map<string, Extract<SessionEvent, { type: "team/task" }>["payload"]["task"]>, self?: string): string[] { const seen = new Set<string>(); return values.map(id => { if (id === self) throw new TeamError("A Team task cannot block itself", "TEAM_TASK_DEPENDENCY_CYCLE"); if (seen.has(id)) throw new TeamError(`Duplicate blocker: ${id}`, "TEAM_INVALID_ARGUMENT"); const task = tasks.get(id); if (task === undefined || task.status === "deleted") throw new TeamError(`Blocker task not found: ${id}`, "TEAM_TASK_NOT_FOUND"); seen.add(id); return id; }); }
function scopes(values: readonly string[]): string[] { const seen = new Set<string>(); return values.map(value => { const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, ""); const segments = normalized.split("/"); if (normalized === "" || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || segments.some(segment => segment === "" || segment === "." || segment === "..")) throw new TeamError(`Invalid workspace-relative write scope ${JSON.stringify(value)}`, "TEAM_INVALID_WRITE_SCOPE"); if (seen.has(normalized)) throw new TeamError(`Duplicate write scope: ${normalized}`, "TEAM_INVALID_ARGUMENT"); seen.add(normalized); return normalized; }); }
function overlaps(a: string, b: string): boolean { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
function required(value: string, name: string, max = Number.MAX_SAFE_INTEGER): string { const normalized = value.trim(); if (normalized === "") throw new TeamError(`${name} must be non-empty`, "TEAM_INVALID_ARGUMENT"); if (normalized.length > max) throw new TeamError(`${name} exceeds ${max} characters`, "TEAM_INVALID_ARGUMENT"); return normalized; }
function contentText(content: readonly ContentBlock[]): string { return content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n"); }
function withoutOwner<T extends { readonly ownerName?: string }>(value: T): Omit<T, "ownerName"> { const { ownerName: _owner, ...rest } = value; return rest; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`); return value; }

export const agentTeamPlugin = definePlugin<AgentTeamConfig, SealHarnessEvents>({ name: "agent-team", provides: [teamServiceToken], requires: [sessionStoreToken, subagentServiceToken, agentServiceToken], async setup(context, config) { const service = new DurableAgentTeamService(context.use(sessionStoreToken), context.use(subagentServiceToken), context.use(agentServiceToken), config); context.provide(teamServiceToken, service); context.on("session.appended", ({ sessionId }) => { void service.notifySessionChanged(sessionId); }); await service.recover(); } });
