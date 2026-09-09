import {
  messageId,
  deriveSessionMessages,
  runId,
  sessionId,
  text,
  type AgentExecution,
  type AgentExecutionResult,
  type AgentForkRequest,
  type AgentPromptRequest,
  type AgentService,
  type RuntimeEvent,
  type SessionStore,
  type ToolDefinition,
  type ToolService,
} from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { LocalJobService } from "@seal-harness/jobs-local";
import { describe, expect, it } from "vitest";
import { DefaultSubagentService } from "../src/index.js";

describe("DefaultSubagentService", () => {
  it("runs children in the background and retains ownership and results in Session metadata", async () => {
    const sessions = new MemorySessionStore();
    const parent = sessionId("parent");
    await sessions.create({ id: parent, cwd: "/workspace" });
    await sessions.append({
      id: parent,
      expectedVersion: 1,
      events: [{ type: "run.started", payload: { runId: runId("parent-run"), model: { provider: "mock", model: "m" } } }],
    });
    const agents = new FakeAgents(sessions);
    const jobs = new LocalJobService();
    const service = new DefaultSubagentService(agents, sessions, 2, 1000, () => "child", jobs);

    const started = await service.spawn({ sessionId: sessionId("reserved-child"), parentSessionId: parent, cwd: "/workspace", prompt: "inspect", label: "Inspector" });
    expect(started).toMatchObject({ sessionId: "reserved-child", parentSessionId: "parent", status: "running", model: { provider: "mock", model: "m" }, jobId: "subagent-1" });
    expect(jobs.get("subagent-1", parent).status).toBe("running");
    expect(await service.list(parent)).toEqual([expect.objectContaining({ label: "Inspector", status: "running" })]);

    await agents.complete(started.sessionId, "finished");
    const waited = await service.wait(parent, [started.sessionId], 1000);
    expect(waited).toEqual({ completed: [expect.objectContaining({ status: "completed", result: "finished" })], timedOut: false });
    expect(jobs.read("subagent-1", parent)).toMatchObject({ job: { status: "completed" }, output: "finished" });

    const restored = new DefaultSubagentService(agents, sessions);
    expect(await restored.list(parent)).toEqual([expect.objectContaining({ sessionId: "reserved-child", status: "completed" })]);
  });

  it("rejects control of a child owned by another Session", async () => {
    const sessions = new MemorySessionStore();
    const agents = new FakeAgents(sessions);
    const parent = sessionId("parent");
    const other = sessionId("other");
    for (const id of [parent, other]) {
      await sessions.create({ id, cwd: "/workspace" });
      await sessions.append({ id, expectedVersion: 1, events: [{ type: "run.started", payload: { runId: runId(`${id}-run`), model: { provider: "mock", model: "m" } } }] });
    }
    const service = new DefaultSubagentService(agents, sessions, 8, 1000, () => "child");
    const child = await service.spawn({ parentSessionId: parent, cwd: "/workspace", prompt: "work" });
    await expect(service.abort(other, child.sessionId)).rejects.toThrow("does not belong");
    await service.abort(parent, child.sessionId);
    await service.dispose();
  });

  it("captures a schema-validated structured result from a fresh child", async () => {
    const sessions = new MemorySessionStore();
    const parent = sessionId("structured-parent");
    await sessions.create({ id: parent, cwd: "/workspace" });
    await sessions.append({ id: parent, expectedVersion: 1, events: [{ type: "run.started", payload: { runId: runId("parent-run"), model: { provider: "mock", model: "m" } } }] });
    const agents = new FakeAgents(sessions);
    let structuredTool: ToolDefinition | undefined;
    const tools = {
      register(tool: ToolDefinition) { structuredTool = tool; return () => { structuredTool = undefined; }; },
    } as ToolService;
    const service = new DefaultSubagentService(agents, sessions, 8, 1000, () => "structured-child", undefined, undefined, tools);
    const child = await service.spawn({
      parentSessionId: parent,
      cwd: "/workspace",
      prompt: "Return the report",
      outputSchema: { type: "object", properties: { status: { type: "string", enum: ["complete"] } }, required: ["status"], additionalProperties: false },
    });
    expect(structuredTool?.name).toBe("structured_output");
    await structuredTool!.execute({ status: "complete" }, { callId: "structured-call" as never, sessionId: child.sessionId, cwd: "/workspace", signal: new AbortController().signal, reportProgress: () => {} });
    await agents.complete(child.sessionId, "done");
    const waited = await service.wait(parent, [child.sessionId], 1000);
    expect(waited.completed[0]).toMatchObject({ structuredResult: { status: "complete" } });
    expect(structuredTool).toBeUndefined();
  });

  it("forks only through the parent's last completed run and assigns child ownership metadata", async () => {
    const sessions = new MemorySessionStore();
    const parent = sessionId("fork-parent");
    await sessions.create({ id: parent, cwd: "/workspace", metadata: { retained: "yes" } });
    await sessions.append({ id: parent, expectedVersion: 1, events: [
      { type: "run.started", payload: { runId: runId("completed-run"), model: { provider: "mock", model: "m" } } },
      { type: "message.appended", payload: { messageId: messageId("parent-message"), runId: runId("completed-run"), message: { role: "assistant", content: [text("completed context")] } } },
      { type: "run.completed", payload: { runId: runId("completed-run"), outcome: "completed" } },
      { type: "run.started", payload: { runId: runId("inflight-run"), model: { provider: "mock", model: "m" } } },
      { type: "message.appended", payload: { messageId: messageId("inflight-message"), runId: runId("inflight-run"), message: { role: "assistant", content: [text("must not inherit")] } } },
    ] });
    const agents = new FakeAgents(sessions);
    const service = new DefaultSubagentService(agents, sessions, 8, 1000, () => "fork-child");
    const child = await service.spawn({ parentSessionId: parent, cwd: "/workspace", prompt: "continue from history", label: "Fork", inheritParentContext: true });
    const forked = await sessions.read(child.sessionId);
    expect(forked?.events.some(entry => entry.event.type === "session.forked" && entry.event.payload.sourceVersion === 4)).toBe(true);
    const inheritedMessages = JSON.stringify(deriveSessionMessages(forked!));
    expect(inheritedMessages).toContain("completed context");
    expect(inheritedMessages).not.toContain("must not inherit");
    expect((forked?.events[0]?.event as any).payload.metadata).toMatchObject({ retained: "yes", "sealHarness.parentSessionId": "fork-parent", "sealHarness.subagentLabel": "Fork" });
    await service.abort(parent, child.sessionId);
    await service.dispose();
  });

  it("supports descendant discovery, adjacent two-way messaging, and ancestor interruption", async () => {
    const sessions = new MemorySessionStore(); const root = sessionId("root");
    await sessions.create({ id: root, cwd: "/workspace" });
    await sessions.append({ id: root, expectedVersion: 1, events: [{ type: "run.started", payload: { runId: runId("root-run"), model: { provider: "mock", model: "m" } } }] });
    const agents = new FakeAgents(sessions); let sequence = 0;
    const service = new DefaultSubagentService(agents, sessions, 8, 1000, () => `child-${++sequence}`);
    const child = await service.spawn({ parentSessionId: root, cwd: "/workspace", prompt: "child" });
    const grandchild = await service.spawn({ parentSessionId: child.sessionId, cwd: "/workspace", prompt: "grandchild" });
    expect((await service.listDescendants(root)).map((entry) => entry.sessionId)).toEqual([child.sessionId, grandchild.sessionId]);

    const downId = messageId("down");
    expect(await service.sendMessage(root, child.sessionId, { id: downId, role: "user", content: [text("down")], source: { kind: "agent-message" } })).toBe(downId);
    const upId = messageId("up");
    expect(await service.sendMessage(child.sessionId, root, { id: upId, role: "user", content: [text("up")], source: { kind: "agent-message" } })).toBe(upId);
    expect(agents.pending.get(root)?.request).toMatchObject({ promptMessageId: upId, promptSource: { kind: "agent-message" } });

    expect(await service.interrupt(root, grandchild.sessionId)).toBe(true);
    await expect(service.interrupt(sessionId("outsider"), grandchild.sessionId)).rejects.toThrow("not descended");
    await service.dispose();
  });
});

class FakeAgents implements AgentService {
  readonly pending = new Map<string, { resolve: (result: AgentExecutionResult) => void; request: AgentPromptRequest }>();
  constructor(readonly sessions: SessionStore) {}

  async prompt(request: AgentPromptRequest): Promise<AgentExecution> {
    const id = request.sessionId ?? sessionId("generated");
    let current = await this.sessions.read(id);
    if (current === undefined) current = await this.sessions.create({ id, cwd: request.cwd, ...(request.metadata === undefined ? {} : { metadata: request.metadata }) });
    const childRun = runId(`run-${id}-${current.version}`);
    current = await this.sessions.append({ id, expectedVersion: current.version, events: [{ type: "run.started", payload: { runId: childRun, model: request.model } }] });
    let resolveResult!: (result: AgentExecutionResult) => void;
    const result = new Promise<AgentExecutionResult>(resolve => { resolveResult = resolve; });
    this.pending.set(id, { resolve: resolveResult, request });
    return {
      sessionId: id,
      runId: childRun,
      result,
      abort: () => { void this.complete(id, "aborted", "aborted"); },
      steer: () => {},
      followUp: () => {},
      async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {},
    };
  }

  async complete(id: import("@seal-harness/core").SessionId, output: string, outcome: "completed" | "aborted" = "completed"): Promise<void> {
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    // Claim completion before yielding: disposal may abort the same fake run.
    this.pending.delete(id);
    const current = await this.sessions.read(id);
    if (current === undefined) throw new Error("missing child");
    const childRun = [...current.events].reverse().find(entry => entry.event.type === "run.started")?.event;
    if (childRun?.type !== "run.started") throw new Error("missing run");
    const next = await this.sessions.append({
      id,
      expectedVersion: current.version,
      events: [
        { type: "message.appended", payload: { messageId: messageId(`message-${id}`), runId: childRun.payload.runId, message: { role: "assistant", content: [text(output)] } } },
        { type: "run.completed", payload: { runId: childRun.payload.runId, outcome } },
      ],
    });
    pending.resolve({
      session: next,
      runtime: {
        messages: [{ role: "assistant", content: [text(output)] }],
        stopReason: outcome === "aborted" ? "aborted" : "stop",
      },
    });
  }

  async fork(request: AgentForkRequest): Promise<import("@seal-harness/core").SessionSnapshot> {
    return this.sessions.fork({ sourceId: request.sourceSessionId, targetId: request.targetSessionId ?? sessionId("fork-generated"), ...(request.throughVersion === undefined ? {} : { throughVersion: request.throughVersion }), ...(request.metadata === undefined ? {} : { metadata: request.metadata }) });
  }
}
