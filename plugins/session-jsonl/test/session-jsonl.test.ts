import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { messageId, SessionConflictError, sessionId, userMessage } from "@piharness/core";
import { JsonlSessionStore } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("JsonlSessionStore", () => {
  it("persists and reloads ordered events", async () => {
    const root = await directory();
    const id = sessionId("session/with-safe-filename");
    const store = new JsonlSessionStore(root, () => new Date("2026-01-01T00:00:00Z"));
    await store.create({ id, cwd: "/workspace" });
    const appended = await store.append({
      id,
      expectedVersion: 1,
      events: [{
        type: "message.appended",
        payload: { messageId: messageId("message"), message: userMessage("hello") },
      }],
    });

    expect(appended.version).toBe(2);
    await expect(new JsonlSessionStore(root).read(id)).resolves.toEqual(appended);
    await expect(store.list()).resolves.toEqual([appended]);
    await expect(store.append({ id, expectedVersion: 1, events: [] }))
      .rejects.toBeInstanceOf(SessionConflictError);
  });

  it("ignores only a malformed final crash tail", async () => {
    const root = await directory();
    const id = sessionId("session");
    const store = new JsonlSessionStore(root);
    const created = await store.create({ id, cwd: "/workspace" });
    const filename = `${Buffer.from(id).toString("base64url")}.jsonl`;
    await appendFile(join(root, filename), "{partial", "utf8");

    await expect(store.read(id)).resolves.toEqual(created);
  });
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "piharness-jsonl-"));
  temporary.push(path);
  return path;
}
