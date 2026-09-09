import { sessionId } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { describe, expect, it } from "vitest";
import { SessionTodoService } from "../src/index.js";

describe("SessionTodoService", () => {
  it("persists a whole-list snapshot and clears its standing view on the next turn", async () => {
    const store = new MemorySessionStore(); const id = sessionId("todos"); let session = await store.create({ id, cwd: "/work" });
    const service = new SessionTodoService(store);
    await service.replace(id, [{ content: "one", status: "in_progress" }, { content: "two", status: "pending" }]);
    expect(await new SessionTodoService(store).get(id)).toEqual([{ content: "one", status: "in_progress" }, { content: "two", status: "pending" }]);
    session = (await store.read(id))!;
    await store.append({ id, expectedVersion: session.version, events: [{ type: "turn.started", payload: { runId: "run" as never, turnId: "turn" as never } }] });
    expect(await service.get(id)).toBeUndefined();
  });

  it("isolates lists by Session", async () => {
    const store = new MemorySessionStore(); const a = sessionId("a"); const b = sessionId("b"); await store.create({ id: a, cwd: "/" }); await store.create({ id: b, cwd: "/" }); const service = new SessionTodoService(store);
    await service.replace(a, [{ content: "only a", status: "completed" }]);
    expect(await service.get(a)).toHaveLength(1); expect(await service.get(b)).toBeUndefined();
  });
});
