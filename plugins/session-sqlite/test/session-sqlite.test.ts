import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { messageId, SessionConflictError, sessionId, userMessage } from "@piharness/core";
import { SqliteSessionStore } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("SqliteSessionStore", () => {
  it("atomically creates, appends, reloads, lists, and forks", async () => {
    const root = await mkdtemp(join(tmpdir(), "piharness-sqlite-"));
    temporary.push(root);
    const path = join(root, "sessions.db");
    const sourceId = sessionId("source");
    const targetId = sessionId("target");
    const store = new SqliteSessionStore(path, () => new Date("2026-01-01T00:00:00Z"));
    try {
      await store.create({ id: sourceId, cwd: "/workspace" });
      const appended = await store.append({
        id: sourceId,
        expectedVersion: 1,
        events: [
          { type: "message.appended", payload: { messageId: messageId("one"), message: userMessage("one") } },
          { type: "message.appended", payload: { messageId: messageId("two"), message: userMessage("two") } },
        ],
      });
      expect(appended.version).toBe(3);
      await expect(store.append({ id: sourceId, expectedVersion: 1, events: [] }))
        .rejects.toBeInstanceOf(SessionConflictError);

      const fork = await store.fork({ sourceId, targetId, throughVersion: 2 });
      expect(fork.events.map((entry) => entry.event.type)).toEqual([
        "session.created", "session.forked", "message.appended",
      ]);
      expect(await store.list()).toHaveLength(2);
    } finally {
      store.close();
    }

    const reopened = new SqliteSessionStore(path);
    try {
      await expect(reopened.read(sourceId)).resolves.toMatchObject({ version: 3 });
      await expect(reopened.read(targetId)).resolves.toMatchObject({ version: 3 });
    } finally {
      reopened.close();
    }
  });

  it("fails closed on an unknown schema version", async () => {
    const root = await mkdtemp(join(tmpdir(), "piharness-sqlite-version-"));
    temporary.push(root);
    const path = join(root, "sessions.db");
    const database = new DatabaseSync(path);
    database.exec("PRAGMA user_version = 99");
    database.close();
    expect(() => new SqliteSessionStore(path)).toThrow("Unsupported SQLite session format");
  });
});
