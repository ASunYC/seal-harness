import { sessionId, type AgentExecution, type AgentForkRequest, type AgentPromptRequest, type AgentService, type RuntimeResult, type SessionId, type SessionSnapshot, type SessionStore } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { DurableScheduleService } from "../src/index.js";

class RecordingAgents implements AgentService {
  readonly requests: AgentPromptRequest[] = [];
  constructor(readonly sessions: SessionStore) {}
  async prompt(request: AgentPromptRequest): Promise<AgentExecution> {
    this.requests.push(request); const current = (await this.sessions.read(request.sessionId!))!;
    const session = await this.sessions.append({ id: current.id, expectedVersion: current.version, events: [...(request.preludeEvents ?? []), { type: "message.appended", payload: { messageId: `message-${this.requests.length}` as never, message: { role: "user", content: request.prompt } } }] });
    const runtime: RuntimeResult = { messages: [{ role: "user", content: request.prompt }], stopReason: "stop" };
    return { sessionId: current.id, runId: `run-${this.requests.length}` as never, result: Promise.resolve({ session, runtime }), abort() {}, steer() {}, followUp() {}, async *[Symbol.asyncIterator]() {} };
  }
  async fork(_request: AgentForkRequest): Promise<SessionSnapshot> { throw new Error("unused"); }
}

describe("DurableScheduleService", () => {
  it("persists, lists, deletes, and never reuses Session-local ids", async () => {
    const { store, agents, parent } = await fixture(); let now = Date.parse("2026-01-01T00:00:00Z"); const service = new DurableScheduleService(store, agents, () => now);
    const first = await service.create({ sessionId: parent, prompt: "one", afterSeconds: 60 }); const recurring = await service.create({ sessionId: parent, prompt: "repeat", everySeconds: 300 });
    expect((await service.list(parent)).map(value => value.id)).toEqual(["schedule-1", "schedule-2"]);
    expect(await service.delete(parent, first.id)).toBe(true); expect(await service.delete(parent, first.id)).toBe(false);
    const third = await service.create({ sessionId: parent, prompt: "three", afterSeconds: 120 }); expect(third.id).toBe("schedule-3");
    expect(recurring.intervalSeconds).toBe(300); await service.dispose();
  });

  it("atomically carries dispatch history with a due reminder and removes one-shots", async () => {
    const { store, agents, parent } = await fixture(); let now = Date.parse("2026-01-01T00:00:00Z"); const service = new DurableScheduleService(store, agents, () => now);
    await service.create({ sessionId: parent, prompt: "check build", afterSeconds: 10 }); now += 10_000; await service.driveDue(parent);
    expect(agents.requests).toHaveLength(1); expect(agents.requests[0]!.preludeEvents?.[0]?.type).toBe("schedule.changed");
    expect((agents.requests[0]!.prompt[0] as { text: string }).text).toContain("check build"); expect(await service.list(parent)).toEqual([]); await service.dispose();
  });

  it("advances recurring reminders from their anchor past missed occurrences and restores after restart", async () => {
    const { store, agents, parent } = await fixture(); let now = Date.parse("2026-01-01T00:00:00Z"); let service = new DurableScheduleService(store, agents, () => now);
    const record = await service.create({ sessionId: parent, prompt: "pulse", everySeconds: 300 }); await service.dispose(); now += 1_000_000;
    service = new DurableScheduleService(store, agents, () => now); await service.start(); await service.driveDue(parent); const next = (await service.list(parent))[0]!;
    expect(Date.parse(next.scheduledAt)).toBeGreaterThan(now); expect((Date.parse(next.scheduledAt) - Date.parse(record.scheduledAt)) % 300_000).toBe(0); await service.dispose();
  });

  it("rejects child Sessions, invalid recurrence, and malformed absolute times", async () => {
    const { store, agents, parent } = await fixture(); const child = sessionId("child"); await store.create({ id: child, cwd: "/work", metadata: { "sealHarness.parentSessionId": parent } }); const service = new DurableScheduleService(store, agents);
    await expect(service.create({ sessionId: child, prompt: "x", afterSeconds: 1 })).rejects.toThrow("root Session");
    await expect(service.create({ sessionId: parent, prompt: "x", everySeconds: 10 })).rejects.toThrow("at least 300");
    await expect(service.create({ sessionId: parent, prompt: "x", at: "2026-01-01" })).rejects.toThrow("RFC 3339"); await service.dispose();
  });

  it("resolves IANA local time, rejects DST gaps, and selects the first overlap instant", async () => {
    const { store, agents, parent } = await fixture(); const service = new DurableScheduleService(store, agents, () => Date.parse("2026-01-01T00:00:00Z"));
    const shanghai = await service.create({ sessionId: parent, prompt: "local", at: { date: "2026-08-06", time: "09:00:00.25", timeZone: "Asia/Shanghai" } });
    expect(shanghai.scheduledAt).toBe("2026-08-06T01:00:00.250Z");
    const overlap = await service.create({ sessionId: parent, prompt: "overlap", at: { date: "2026-11-01", time: "01:30:00", timeZone: "America/New_York" } });
    expect(overlap.scheduledAt).toBe("2026-11-01T05:30:00.000Z");
    await expect(service.create({ sessionId: parent, prompt: "gap", at: { date: "2026-03-08", time: "02:30:00", timeZone: "America/New_York" } })).rejects.toThrow("does not exist");
    await expect(service.create({ sessionId: parent, prompt: "zone", at: { date: "2026-08-06", time: "09:00:00", timeZone: "CST" } })).rejects.toThrow("IANA"); await service.dispose();
  });
});

async function fixture() { const store = new MemorySessionStore(); const parent = sessionId("parent"); let session = await store.create({ id: parent, cwd: "/work" }); session = await store.append({ id: parent, expectedVersion: session.version, events: [{ type: "run.started", payload: { runId: "run" as never, model: { provider: "p", model: "m" } } }] }); return { store, agents: new RecordingAgents(store), parent }; }
