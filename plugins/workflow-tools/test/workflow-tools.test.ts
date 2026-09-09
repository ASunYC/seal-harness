import { sessionId, type AgentMessage, type SessionId, type SpawnSubagentRequest, type SubagentService, type SubagentSnapshot, type WaitSubagentsResult } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { WorkerWorkflowRunner } from "../src/index.js";

class FakeSubagents implements SubagentService {
  readonly children = new Map<SessionId, SubagentSnapshot>();
  readonly aborted: SessionId[] = [];
  sequence = 0;
  async spawn(request: SpawnSubagentRequest): Promise<SubagentSnapshot> {
    const id = sessionId(`child-${++this.sequence}`); const result = request.prompt === "json" ? '{"ok":true}' : `done:${request.prompt}`;
    const child: SubagentSnapshot = { sessionId: id, parentSessionId: request.parentSessionId, label: request.label ?? id, status: request.prompt === "slow" ? "running" : "completed", model: request.model ?? { provider: "p", model: "m" }, result };
    this.children.set(id, child); return { ...child, status: "running" };
  }
  async list(parent: SessionId) { return [...this.children.values()].filter(value => value.parentSessionId === parent); }
  async wait(_parent: SessionId, ids: readonly SessionId[], _timeout: number, signal?: AbortSignal): Promise<WaitSubagentsResult> {
    const child = this.children.get(ids[0]!); if (child?.status !== "running") return { completed: child === undefined ? [] : [child], timedOut: false };
    await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return { completed: [], timedOut: true };
  }
  async send(_parent: SessionId, _child: SessionId, _message: AgentMessage): Promise<SubagentSnapshot> { throw new Error("unused"); }
  async abort(_parent: SessionId, child: SessionId) { this.aborted.push(child); const value = this.children.get(child); if (value !== undefined) this.children.set(child, { ...value, status: "aborted" }); return value !== undefined; }
}

describe("WorkerWorkflowRunner", () => {
  it("runs parallel/pipeline agents, validates structured results, and records lifecycle", async () => {
    const store = new MemorySessionStore(); const parent = sessionId("parent"); let session = await store.create({ id: parent, cwd: "/work" });
    session = await store.append({ id: parent, expectedVersion: session.version, events: [{ type: "run.started", payload: { runId: "run" as never, model: { provider: "p", model: "m" } } }] });
    const subagents = new FakeSubagents(); const runner = new WorkerWorkflowRunner(subagents, store, { idFactory: () => "fixed", maxConcurrentAgents: 2 });
    const result = await runner.run(parent, "/work", `
      phase("scan"); log("starting");
      const first = await parallel([() => agent("one"), () => agent("json", { schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } })]);
      const second = await pipeline(["a", "b"], async (_prev, item) => agent(item, { phase: "verify" }));
      return { first, second };
    `, { name: "audit-flow", description: "audit" }, undefined, new AbortController().signal);
    expect(result).toMatchObject({ workflowId: "workflow-fixed", outcome: "completed", agentsStarted: 4, value: { first: ["done:one", { ok: true }], second: ["done:a", "done:b"] } });
    const recorded = (await store.read(parent))!.events.filter(value => value.event.type.startsWith("workflow."));
    expect(recorded.map(value => value.event.type)).toEqual(["workflow.started", "workflow.agent.started", "workflow.agent.completed", "workflow.agent.started", "workflow.agent.completed", "workflow.agent.started", "workflow.agent.completed", "workflow.agent.started", "workflow.agent.completed", "workflow.completed"]);
  });

  it("fails boundedly on synchronous runaway code", async () => {
    const { store, parent } = await fixture(); const runner = new WorkerWorkflowRunner(new FakeSubagents(), store, { syncTimeoutMs: 20 });
    const result = await runner.run(parent, "/work", "while (true) {}", { name: "runaway", description: "test" }, undefined, new AbortController().signal);
    expect(result.outcome).toBe("failed"); expect(result.error).toMatch(/timed out/i);
  });

  it("propagates cancellation and aborts live children", async () => {
    const { store, parent } = await fixture(); const subagents = new FakeSubagents(); const runner = new WorkerWorkflowRunner(subagents, store, { cancellationGraceMs: 50 }); const controller = new AbortController();
    const running = runner.run(parent, "/work", 'return await agent("slow")', { name: "cancel-flow", description: "test" }, undefined, controller.signal);
    await until(() => subagents.children.size === 1); controller.abort(new Error("stop")); const result = await running;
    expect(result.outcome).toBe("aborted"); expect(subagents.aborted).toEqual([sessionId("child-1")]);
  });

  it("reaps an unawaited child before recording workflow completion", async () => {
    const { store, parent } = await fixture(); const subagents = new FakeSubagents(); const runner = new WorkerWorkflowRunner(subagents, store);
    const result = await runner.run(parent, "/work", 'agent("slow"); return "done"', { name: "dropped-child", description: "test" }, undefined, new AbortController().signal);
    expect(result.outcome).toBe("completed"); expect(subagents.aborted).toEqual([sessionId("child-1")]);
    const types = (await store.read(parent))!.events.map(value => value.event.type);
    expect(types.slice(-3)).toEqual(["workflow.agent.started", "workflow.agent.completed", "workflow.completed"]);
  });
});

async function fixture() { const store = new MemorySessionStore(); const parent = sessionId("parent"); let session = await store.create({ id: parent, cwd: "/work" }); session = await store.append({ id: parent, expectedVersion: session.version, events: [{ type: "run.started", payload: { runId: "run" as never, model: { provider: "p", model: "m" } } }] }); return { store, parent }; }
async function until(predicate: () => boolean) { const end = Date.now() + 2000; while (!predicate()) { if (Date.now() > end) throw new Error("timed out"); await new Promise(resolve => setTimeout(resolve, 5)); } }
