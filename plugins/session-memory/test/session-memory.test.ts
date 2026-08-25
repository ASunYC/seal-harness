import { describe, expect, it } from "vitest";
import {
  messageId,
  SessionAlreadyExistsError,
  SessionConflictError,
  sessionId,
  userMessage,
} from "@piharness/core";
import { MemorySessionStore } from "../src/index.js";

describe("MemorySessionStore", () => {
  it("creates, appends, clones, and lists an event stream", async () => {
    const timestamps = [new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:01Z")];
    const store = new MemorySessionStore(() => timestamps.shift() ?? new Date(0));
    const id = sessionId("session-1");
    const created = await store.create({ id, cwd: "/workspace" });
    expect(created).toMatchObject({ id, version: 1 });

    const appended = await store.append({
      id,
      expectedVersion: 1,
      events: [{
        type: "message.appended",
        payload: { messageId: messageId("message-1"), message: userMessage("hello") },
      }],
    });
    expect(appended.version).toBe(2);
    expect(appended.events.map((event) => event.sequence)).toEqual([1, 2]);

    const read = await store.read(id);
    expect(read).toEqual(appended);
    expect(read).not.toBe(appended);
    expect(await store.list()).toEqual([appended]);
  });

  it("rejects duplicate creation and stale appends", async () => {
    const store = new MemorySessionStore();
    const id = sessionId("session-1");
    await store.create({ id, cwd: "/workspace" });

    await expect(store.create({ id, cwd: "/workspace" }))
      .rejects.toBeInstanceOf(SessionAlreadyExistsError);
    await expect(store.append({ id, expectedVersion: 0, events: [] }))
      .rejects.toBeInstanceOf(SessionConflictError);
  });
});
