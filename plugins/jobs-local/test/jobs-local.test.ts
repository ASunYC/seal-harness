import { runId, sessionId, type JobOutcome } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { JobCompletionDelivery, LocalJobService } from "../src/index.js";

describe("LocalJobService", () => {
  it("tracks completion, bounded output, and owner access", async () => {
    let resolve!: (outcome: JobOutcome) => void;
    let output = "abcdef";
    const service = new LocalJobService(2, 1000, () => 10);
    const owner = sessionId("owner");
    const changes: Array<string | undefined> = []; service.subscribe?.((changed) => changes.push(changed));
    const id = service.start({
      kind: "test",
      label: "background work",
      ownerSession: owner,
      outputLimitBytes: 4,
      run: () => ({
        cancel() {},
        done: new Promise<JobOutcome>(done => { resolve = done; }),
        readOutput: () => { const value = output; output = ""; return value; },
      }),
    });

    expect(service.get(id, owner).status).toBe("running");
    expect(service.read(id, owner).output).toBe("abcd");
    expect(service.read(id, owner).output).toBe("");
    expect(() => service.get(id, sessionId("other"))).toThrow("not owned");

    resolve({ status: "completed", detail: "ok" });
    expect(await service.wait(id, 1000, owner)).toMatchObject({ status: "completed", detail: "ok", finishedAt: 10 });
    expect(changes).toEqual([owner, owner]);
  });

  it("enforces concurrency and cancellation settles through producer cleanup", async () => {
    let resolve!: (outcome: JobOutcome) => void;
    const service = new LocalJobService(1);
    const owner = sessionId("owner");
    const id = service.start({
      kind: "test",
      label: "first",
      ownerSession: owner,
      run: () => ({
        cancel: () => resolve({ status: "cancelled", detail: "stopped" }),
        done: new Promise<JobOutcome>(done => { resolve = done; }),
      }),
    });
    expect(() => service.start({
      kind: "test",
      label: "second",
      ownerSession: owner,
      run: () => ({ cancel() {}, done: Promise.resolve({ status: "completed" }) }),
    })).toThrow("limit reached");

    expect(service.cancel(id, owner).status).toBe("stopping");
    expect(await service.wait(id, 1000, owner)).toMatchObject({ status: "cancelled", detail: "stopped" });
  });

  it("converts a producer rejection into a failed terminal job", async () => {
    const service = new LocalJobService();
    const id = service.start({
      kind: "test",
      label: "rejecting",
      run: () => ({ cancel() {}, done: Promise.reject(new Error("producer failed")) }),
    });
    expect(await service.wait(id, 1000)).toMatchObject({ status: "failed", detail: "producer failed" });
  });

  it("wakes idle owners within the limit and then degrades to durable quiet delivery", async () => {
    const sessions = new MemorySessionStore(); const owner = sessionId("owner"); const prompts: any[] = [];
    await sessions.create({ id: owner, cwd: "/workspace", initialEvents: [{ type: "run.started", payload: { runId: runId("run-1"), model: { provider: "test", model: "worker" }, reasoning: "high", maxTokens: 123 } }, { type: "run.completed", payload: { runId: runId("run-1"), outcome: "completed" } }] });
    const delivery = new JobCompletionDelivery({ active: () => undefined, async prompt(request: any) { prompts.push(request); return { result: Promise.resolve({}) }; }, async fork() { throw new Error("unused"); } } as any, sessions, "wakeup", 1);
    await delivery.deliver({ id: "job-1", kind: "test", label: "first", ownerSession: owner, status: "completed", startedAt: 1, finishedAt: 2 });
    await delivery.deliver({ id: "job-2", kind: "test", label: "second", ownerSession: owner, status: "failed", detail: "boom", startedAt: 3, finishedAt: 4 });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ sessionId: owner, cwd: "/workspace", model: { provider: "test", model: "worker" }, reasoning: "high", maxTokens: 123, promptSource: { kind: "job-completion", jobId: "job-1" } });
    const stored = await sessions.read(owner);
    expect(stored?.events.at(-1)?.event).toMatchObject({ type: "message.appended", payload: { message: { source: { kind: "job-completion", jobId: "job-2" } } } });
  });

  it("injects completion into a busy owner without opening another turn", async () => {
    const sessions = new MemorySessionStore(); const owner = sessionId("owner"); const followed: any[] = [];
    const delivery = new JobCompletionDelivery({ active: () => ({ followUp(message: any) { followed.push(message); } }), async prompt() { throw new Error("must not wake"); }, async fork() { throw new Error("unused"); } } as any, sessions);
    await delivery.deliver({ id: "job-1", kind: "test", label: "busy", ownerSession: owner, status: "completed", startedAt: 1, finishedAt: 2 });
    expect(followed).toEqual([expect.objectContaining({ source: { kind: "job-completion", jobId: "job-1" } })]);
  });
});
