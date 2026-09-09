import {
  SessionConflictError, sessionId, type AgentService, type SessionId,
  type SpawnSubagentRequest, type SubagentService, type SubagentSnapshot, type WaitSubagentsResult,
} from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it, vi } from "vitest";
import { DurableAgentTeamService } from "../src/index.js";

const PARENT_KEY = "sealHarness.parentSessionId";

class FakeSubagents implements SubagentService {
  readonly rows = new Map<SessionId, SubagentSnapshot>();
  constructor(readonly sessions: MemorySessionStore) {}
  async spawn(request: SpawnSubagentRequest): Promise<SubagentSnapshot> {
    const id = request.sessionId!; const parent = (await this.sessions.read(request.parentSessionId))!;
    let child = request.inheritParentContext === true
      ? await this.sessions.fork({ sourceId: parent.id, targetId: id, metadata: { [PARENT_KEY]: parent.id, "sealHarness.subagentLabel": request.label ?? id } })
      : await this.sessions.create({ id, cwd: request.cwd, metadata: { [PARENT_KEY]: parent.id, "sealHarness.subagentLabel": request.label ?? id } });
    child = await this.sessions.append({ id, expectedVersion: child.version, events: [{ type: "run.started", payload: { runId: "run" as never, model: request.model ?? { provider: "test", model: "model" } } }] });
    const row: SubagentSnapshot = { sessionId: id, parentSessionId: parent.id, label: request.label ?? id, status: "running", model: request.model ?? { provider: "test", model: "model" } }; this.rows.set(id, row); return row;
  }
  async list(parent: SessionId) { return [...this.rows.values()].filter(row => row.parentSessionId === parent); }
  async listDescendants(parent: SessionId) { return this.list(parent); }
  async wait(_parent: SessionId, _ids: readonly SessionId[], _timeout: number): Promise<WaitSubagentsResult> { return { completed: [], timedOut: true }; }
  async send(parent: SessionId, id: SessionId, message: any) { const row = this.rows.get(id)!; expect(row.parentSessionId).toBe(parent); const current = (await this.sessions.read(id))!; await this.sessions.append({ id, expectedVersion: current.version, events: [{ type: "message.appended", payload: { messageId: message.id, message } }] }); return row; }
  async sendMessage(sender: SessionId, target: SessionId, message: any) { if (target === sessionId("lead")) { const current = (await this.sessions.read(target))!; await this.sessions.append({ id: target, expectedVersion: current.version, events: [{ type: "message.appended", payload: { messageId: message.id, message } }] }); } else await this.send(sender, target, message); return message.id; }
  async abort() { return true; }
  interrupt = vi.fn(async () => true);
}

async function fixture() {
  const sessions = new MemorySessionStore(); const lead = sessionId("lead"); let root = await sessions.create({ id: lead, cwd: "/work" }); root = await sessions.append({ id: lead, expectedVersion: root.version, events: [{ type: "run.started", payload: { runId: "lead-run" as never, model: { provider: "test", model: "model" } } }] });
  const subagents = new FakeSubagents(sessions); const active = new Map<SessionId, object>([[lead, {}]]); const agents = { active: (id: SessionId) => active.get(id) } as unknown as AgentService;
  let next = 0; const teams = new DurableAgentTeamService(sessions, subagents, agents, { idFactory: () => String(++next) }); return { sessions, subagents, teams, lead };
}

describe("DurableAgentTeamService", () => {
  it("creates durable named teammates and reserves names", async () => { const { teams, lead } = await fixture(); const member = await teams.spawnTeammate(lead, { name: "reviewer", description: "Review changes", prompt: [{ type: "text", text: "Review" }] }); expect(member).toMatchObject({ name: "reviewer", role: "teammate", status: "running", context: "fresh" }); await expect(teams.spawnTeammate(lead, { name: "reviewer", description: "Again", prompt: [{ type: "text", text: "Again" }] })).rejects.toMatchObject({ code: "TEAM_MEMBER_EXISTS" }); expect((await teams.listMembers(member.id)).map(row => row.name)).toEqual(["lead", "reviewer"]); });

  it("persists peer delivery before acknowledging it", async () => { const { teams, sessions, lead } = await fixture(); const first = await teams.spawnTeammate(lead, { name: "writer", description: "Write", prompt: [{ type: "text", text: "Write" }] }); const second = await teams.spawnTeammate(lead, { name: "reviewer", description: "Review", prompt: [{ type: "text", text: "Review" }] }); const result = await teams.sendMessage(first.id, { target: "reviewer", content: [{ type: "text", text: "Please review" }] }); expect(result).toEqual({ messageId: "team-message-3", status: "accepted" }); const root = (await sessions.read(lead))!; expect(root.events.slice(-2).map(row => row.event.type)).toEqual(["team/message/queued", "team/message/delivered"]); const target = (await sessions.read(second.id))!; expect(target.events.some(row => row.event.type === "message.appended" && row.event.payload.message.content.some(block => block.type === "text" && block.text.includes("from writer")))).toBe(true); });

  it("replays durable queued peer mail after a service restart", async () => { const { teams, sessions, subagents, lead } = await fixture(); const first = await teams.spawnTeammate(lead, { name: "writer", description: "Write", prompt: [{ type: "text", text: "Write" }] }); const second = await teams.spawnTeammate(lead, { name: "reviewer", description: "Review", prompt: [{ type: "text", text: "Review" }] }); vi.spyOn(subagents, "send").mockRejectedValueOnce(new Error("temporarily unavailable")); expect(await teams.sendMessage(first.id, { target: "reviewer", content: [{ type: "text", text: "Queued review" }] })).toMatchObject({ status: "queued" }); const restarted = new DurableAgentTeamService(sessions, subagents, {} as AgentService, { idFactory: () => "restart" }); await restarted.recover(); const root = (await sessions.read(lead))!; expect(root.events.at(-1)?.event).toMatchObject({ type: "team/message/delivered", payload: { messageId: "team-message-3" } }); const target = (await sessions.read(second.id))!; expect(target.events.filter(row => row.event.type === "message.appended" && row.event.payload.message.role === "user" && row.event.payload.message.id === "team-message-3")).toHaveLength(1); });

  it("enforces task DAG readiness, CAS revisions, ownership, and overlap warnings", async () => { const { teams, lead } = await fixture(); await teams.spawnTeammate(lead, { name: "writer", description: "Write", prompt: [{ type: "text", text: "Write" }] }); const first = await teams.createTask(lead, { subject: "Foundation", description: "Build base", writeScopes: ["src"] }); const second = await teams.createTask(lead, { subject: "Feature", description: "Build feature", blockedBy: [first.id], writeScopes: ["src/feature"] }); expect(second.ready).toBe(false); const claimed = await teams.updateTask(lead, { taskId: first.id, expectedRevision: 1, action: "reassign", owner: "writer" }); expect(claimed.status).toBe("in_progress"); await expect(teams.updateTask(lead, { taskId: first.id, expectedRevision: 1, action: "complete" })).rejects.toMatchObject({ code: "TEAM_TASK_STALE_REVISION" }); const done = await teams.updateTask(lead, { taskId: first.id, expectedRevision: 2, action: "complete" }); expect(done.status).toBe("completed"); expect((await teams.getTask(lead, second.id)).ready).toBe(true); const runningSecond = await teams.updateTask(lead, { taskId: second.id, expectedRevision: 1, action: "claim" }); expect(runningSecond.ownerName).toBe("lead"); const third = await teams.createTask(lead, { subject: "Other", description: "Other", writeScopes: ["src/feature/file.ts"] }); const runningThird = await teams.updateTask(lead, { taskId: third.id, expectedRevision: 1, action: "claim" }); expect(runningThird.writeScopeWarnings).toContain(`write scope overlaps ${second.id}`); });

  it("matches upstream validation and dependent-task deletion guards", async () => { const { teams, lead } = await fixture(); await expect(teams.spawnTeammate(lead, { name: "Bad_Name", description: "bad", prompt: [{ type: "text", text: "bad" }] })).rejects.toMatchObject({ code: "TEAM_INVALID_MEMBER_NAME" }); await expect(teams.createTask(lead, { subject: "Bad scope", description: "bad", writeScopes: ["../outside"] })).rejects.toMatchObject({ code: "TEAM_INVALID_WRITE_SCOPE" }); const first = await teams.createTask(lead, { subject: "First", description: "First" }); await expect(teams.createTask(lead, { subject: "Duplicate", description: "Duplicate", blockedBy: [first.id, first.id] })).rejects.toMatchObject({ code: "TEAM_INVALID_ARGUMENT" }); await teams.createTask(lead, { subject: "Dependent", description: "Dependent", blockedBy: [first.id] }); await expect(teams.updateTask(lead, { taskId: first.id, expectedRevision: 1, action: "delete" })).rejects.toMatchObject({ code: "TEAM_TASK_HAS_DEPENDENTS" }); });

  it("wakes a registered change waiter", async () => { const { teams, lead } = await fixture(); const waiting = teams.waitForChange(lead, 10_000); await teams.createTask(lead, { subject: "Wake", description: "Wake waiter" }); await expect(waiting).resolves.toEqual({ timedOut: false }); });
});
