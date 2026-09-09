import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveSessionMessages, messageId, sessionId } from "@seal-harness/core";
import { MemorySessionStore } from "@seal-harness/session-memory";
import { DEFAULT_FEEDBACK_NOTE_BYTES, DurableMessageFeedbackService } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function temporaryRoot(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "seal-feedback-")); roots.push(value); return value; }

describe("feedback", () => {
  it("persists optimistic assistant-message feedback outside the session event log", async () => {
    const store = new MemorySessionStore(); const id = sessionId("s"); let session = await store.create({ id, cwd: "/w" });
    session = await store.append({ id, expectedVersion: session.version, events: [{ type: "message.appended", payload: { messageId: messageId("m"), message: { role: "assistant", content: [{ type: "text", text: "done" }] } } }] });
    const root = await temporaryRoot(); const service = new DurableMessageFeedbackService(store, { root }, () => "v1", () => new Date(0));
    expect(service.maxNoteBytes).toBe(DEFAULT_FEEDBACK_NOTE_BYTES);
    await service.put({ sessionId: id, messageId: "m", rating: "up", note: "useful", ifVersion: null });
    expect((await store.read(id))?.version).toBe(session.version); expect(deriveSessionMessages((await store.read(id))!)).toHaveLength(1);
    await expect(service.put({ sessionId: id, messageId: "m", rating: "down", ifVersion: null })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const boundaryItem = await service.put({ sessionId: id, messageId: "m", rating: "down", note: "界".repeat(2_730), ifVersion: "v1" });
    expect(boundaryItem).toMatchObject({ rating: "down" });
    await expect(service.put({ sessionId: id, messageId: "m", rating: "down", note: "界".repeat(2_731), ifVersion: "v1" })).rejects.toMatchObject({ code: "NOTE_TOO_LARGE" });
    expect(await new DurableMessageFeedbackService(store, { root }).list(id)).toEqual([boundaryItem]);
    await expect(service.delete({ sessionId: id, messageId: "m", ifVersion: "v1" })).resolves.toBe(true); expect(await service.list(id)).toEqual([]);
  });
  it("rejects non-assistant targets", async () => { const store = new MemorySessionStore(); const id = sessionId("s"); await store.create({ id, cwd: "/w" }); const service = new DurableMessageFeedbackService(store, { root: await temporaryRoot() }); await expect(service.put({ sessionId: id, messageId: "missing", rating: "up", ifVersion: null })).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" }); });
});
