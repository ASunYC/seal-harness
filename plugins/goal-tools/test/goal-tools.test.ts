import { messageId, runId, sessionId, text } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { requireDirectHuman, SessionGoalService } from "../src/index.js";

async function fixture() {
  const store = new MemorySessionStore();
  const id = sessionId("session-one");
  await store.create({ id, cwd: "/workspace" });
  let clock = 100;
  const goals = new SessionGoalService(store, 8, () => "fixed", () => ++clock);
  return { store, id, goals };
}

describe("SessionGoalService", () => {
  it("persists revisions and reloads active goals disarmed", async () => {
    const { store, id, goals } = await fixture();
    const created = await goals.create(id, { objective: "  ship it  " });
    expect(created).toMatchObject({ id: "goal-fixed", revision: 1, objective: "ship it", phase: "active", maxGoalRounds: 8, activation: "armed" });

    const edited = await goals.edit(id, created, { maxGoalRounds: 12 });
    expect(edited).toMatchObject({ revision: 2, maxGoalRounds: 12, activation: "armed" });
    const reloaded = new SessionGoalService(store);
    expect(await reloaded.get(id)).toMatchObject({ revision: 2, objective: "ship it", activation: "disarmed" });
    await expect(goals.pause(id, created)).rejects.toMatchObject({ code: "GOAL_REVISION_CONFLICT" });
  });

  it("enforces lifecycle transitions and permits replacement only after completion", async () => {
    const { id, goals } = await fixture();
    const created = await goals.create(id, { objective: "first" });
    await expect(goals.create(id, { objective: "second" })).rejects.toMatchObject({ code: "GOAL_ALREADY_EXISTS" });
    const blocked = await goals.block(id, created, { code: "external-wait", message: " waiting " });
    expect(blocked).toMatchObject({ phase: "blocked", revision: 2, activation: "disarmed", blockedReason: { message: "waiting" } });
    await expect(goals.pause(id, blocked)).rejects.toMatchObject({ code: "GOAL_INVALID_TRANSITION" });
    const resumed = await goals.resume(id, blocked);
    const complete = await goals.complete(id, resumed);
    expect(complete).toMatchObject({ phase: "complete", revision: 4, activation: "disarmed" });
    const replacement = await goals.create(id, { objective: "second", maxGoalRounds: 2 });
    expect(replacement).toMatchObject({ revision: 1, objective: "second", maxGoalRounds: 2 });
  });

  it("carries durable goal state into a fork but not activation", async () => {
    const { store, id, goals } = await fixture();
    const created = await goals.create(id, { objective: "forkable" });
    const child = sessionId("child");
    await store.fork({ sourceId: id, targetId: child });
    expect(await goals.get(child)).toMatchObject({ id: created.id, revision: 1, activation: "disarmed" });
  });

  it("clears an exact revision with a durable one-past tombstone", async () => {
    const { store, id, goals } = await fixture();
    const created = await goals.create(id, { objective: "temporary" });
    await expect(goals.clear(id, { ...created, revision: 2 })).rejects.toMatchObject({ code: "GOAL_REVISION_CONFLICT" });
    await expect(goals.clear(id, created)).resolves.toEqual({ id: created.id, revision: 2 });
    await expect(goals.get(id)).resolves.toBeUndefined();
    await expect(new SessionGoalService(store).get(id)).resolves.toBeUndefined();
    await expect(goals.create(id, { objective: "replacement" })).resolves.toMatchObject({ revision: 1, objective: "replacement" });
  });

  it("serializes concurrent compare-and-set mutations", async () => {
    const { id, goals } = await fixture();
    const created = await goals.create(id, { objective: "race" });
    const results = await Promise.allSettled([
      goals.pause(id, created),
      goals.complete(id, created),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  it("authorizes goal policy mutations only from the current direct human run", async () => {
    const store = new MemorySessionStore(); const id = sessionId("policy-session");
    let current = await store.create({ id, cwd: "/workspace" });
    current = await store.append({ id, expectedVersion: current.version, events: [
      { type: "message.appended", payload: { messageId: messageId("human"), message: { role: "user", content: [text("start")], source: { kind: "user-rpc" } } } },
      { type: "run.started", payload: { runId: runId("human-run"), model: { provider: "mock", model: "m" } } },
    ] });
    await expect(requireDirectHuman(store, id)).resolves.toBeUndefined();
    await store.append({ id, expectedVersion: current.version, events: [
      { type: "message.appended", payload: { messageId: messageId("goal"), message: { role: "user", content: [text("continue")], source: { kind: "goal" } } } },
      { type: "run.started", payload: { runId: runId("goal-run"), model: { provider: "mock", model: "m" } } },
    ] });
    await expect(requireDirectHuman(store, id)).rejects.toMatchObject({ code: "GOAL_TOOL_REQUIRES_HUMAN" });
  });
});
