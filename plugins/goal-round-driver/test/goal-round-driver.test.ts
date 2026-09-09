import {
  agentServiceToken, goalServiceToken, runId, sessionId, sessionStoreToken,
  type AgentExecution, type AgentPromptRequest, type AgentService, type RuntimeEvent,
  type SealHarnessEvents, type StoredSessionEvent,
} from "@seal-harness/core";
import { SessionGoalService } from "@seal-harness/goal-tools";
import { Kernel, plugin } from "@seal-harness/kernel";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { goalRoundDriverPlugin, renderGoalRoundPrompt } from "../src/index.js";

describe("goal round driver", () => {
  it("admits a same-session round and blocks at the configured cap", async () => {
    const store = new MemorySessionStore();
    const id = sessionId("goal-session");
    let snapshot = await store.create({ id, cwd: "/work" });
    snapshot = await store.append({ id, expectedVersion: snapshot.version, events: [{ type: "run.started", payload: { runId: runId("human-run"), model: { provider: "mock", model: "model" } } }] });
    const goals = new SessionGoalService(store, 1, () => "id", () => 10);
    await goals.create(id, { objective: "finish" });
    const agents = new RecordingAgents();
    const kernel = new Kernel<SealHarnessEvents>({ initialServices: [[sessionStoreToken, store], [goalServiceToken, goals], [agentServiceToken, agents]] });
    await kernel.start([plugin(goalRoundDriverPlugin, {})]);

    await kernel.emit("session.appended", { sessionId: id, events: [completedEvent(4)] });
    await eventually(() => agents.requests.length === 1);
    expect(agents.requests[0]).toMatchObject({ sessionId: id, cwd: "/work", model: { provider: "mock", model: "model" }, promptSource: { kind: "goal" } });
    expect(agents.requests[0]?.prompt[0]).toMatchObject({ type: "text", text: expect.stringContaining("Round: 1/1") });
    expect(await goals.get(id)).toMatchObject({ roundsStarted: 1, revision: 1, phase: "active" });

    await kernel.emit("session.appended", { sessionId: id, events: [completedEvent(5)] });
    await eventually(async () => (await goals.get(id))?.phase === "blocked");
    expect(await goals.get(id)).toMatchObject({ phase: "blocked", revision: 2, blockedReason: { code: "round-limit" } });
    await kernel.stop();
  });

  it("renders the retained DeepSeek-compatible round prompt", () => {
    const prompt = renderGoalRoundPrompt({ id: "g", revision: 2, objective: "ship", phase: "active", maxGoalRounds: 3, roundsStarted: 0, createdAt: 1, updatedAt: 1, activation: "armed" }, 1);
    expect(prompt[0]?.text).toContain('Objective: "ship"');
    expect(prompt[0]?.text).toContain("Round: 1/3");
  });
});

class RecordingAgents implements AgentService {
  readonly requests: AgentPromptRequest[] = [];
  async prompt(request: AgentPromptRequest): Promise<AgentExecution> {
    this.requests.push(request);
    return { sessionId: request.sessionId ?? sessionId("generated"), runId: runId("auto"), result: new Promise(() => {}), abort() {}, steer() {}, followUp() {}, async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {} };
  }
  async fork(): Promise<never> { throw new Error("unused"); }
}

function completedEvent(sequence: number): StoredSessionEvent { return { sequence, timestamp: new Date(0).toISOString(), event: { type: "run.completed", payload: { runId: runId(`run-${sequence}`), outcome: "completed" } } }; }
async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> { for (let index = 0; index < 50; index += 1) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); } throw new Error("condition not reached"); }
