import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionId, toolCallId } from "@seal-harness/core";
import { reviewedWrite, readReviewSnapshot, rollbackReviewSnapshot } from "../src/review-snapshot.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "seal-review-")); roots.push(cwd);
  return { cwd, path: join(cwd, "file.txt"), root: join(cwd, "snapshots"), context: { cwd, sessionId: sessionId("../session"), callId: toolCallId("call"), signal: new AbortController().signal, reportProgress() {} } };
}
async function snapshot(root: string) { const session = (await readdir(root))[0]!; const id = (await readdir(join(root, session)))[0]!; return join(root, session, id); }
describe("write review snapshots", () => {
  it("recovers an exited owner's lock and an already-restored pending operation", async () => {
    const f = await setup(); await writeFile(f.path, "before");
    const result = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, () => writeFile(f.path, "after"));
    const directory = await snapshot(f.root); const metaPath = join(directory, "meta.json");
    const record = JSON.parse(await readFile(metaPath, "utf8"));
    await writeFile(metaPath, JSON.stringify({ ...record, rollbackPending: true }));
    await writeFile(f.path, "before");
    const child = spawn(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", () => resolve()); });
    await mkdir(join(directory, "rollback.lock"));
    await writeFile(join(directory, "rollback.lock", "owner.json"), JSON.stringify({ pid: child.pid }));
    expect(await rollbackReviewSnapshot(f.root, f.context.sessionId, String(result?.snapshotId), f.cwd)).toBe("rolled-back");
    expect(await readFile(f.path, "utf8")).toBe("before");
    expect((await readReviewSnapshot(f.root, f.context.sessionId, String(result?.snapshotId)))?.status).toBe("rolled-back");
  });
  it("never steals a live or unidentified lock", async () => {
    const f = await setup();
    const result = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, () => writeFile(f.path, "after"));
    const directory = await snapshot(f.root); const lock = join(directory, "rollback.lock"); await mkdir(lock);
    const attempt = () => rollbackReviewSnapshot(f.root, f.context.sessionId, String(result?.snapshotId), f.cwd);
    expect(await attempt()).toBe("busy");
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
    expect(await attempt()).toBe("busy"); expect(await readFile(f.path, "utf8")).toBe("after");
  });
  it("waits for an in-flight native write before checking rollback conflicts", async () => {
    const f = await setup(); await writeFile(f.path, "before");
    const original = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, () => writeFile(f.path, "after"));
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const writer = reviewedWrite(f.root, f.path, "file.txt", "new work", f.context, async () => { entered(); await gate; await writeFile(f.path, "new work"); });
    await started;
    const rollback = rollbackReviewSnapshot(f.root, f.context.sessionId, String(original?.snapshotId), f.cwd);
    release(); await writer;
    expect(await rollback).toBe("conflict"); expect(await readFile(f.path, "utf8")).toBe("new work");
  });
  it("rejects edits prepared from stale content and releases the queue after errors", async () => {
    const f = await setup(); await writeFile(f.path, "newer");
    await expect(reviewedWrite(f.root, f.path, "file.txt", "stale replacement", f.context, () => writeFile(f.path, "stale replacement"), "old")).rejects.toThrow("File changed");
    expect(await readFile(f.path, "utf8")).toBe("newer");
    await reviewedWrite(f.root, f.path, "file.txt", "valid", f.context, () => writeFile(f.path, "valid"), "newer");
    expect(await readFile(f.path, "utf8")).toBe("valid");
  });
  it("restores original bytes and persists idempotent rollback without touching later edits", async () => {
    const f = await setup(); await writeFile(f.path, "\ufeffbefore\r\n");
    const result = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, () => writeFile(f.path, "after"));
    const id = String(result?.snapshotId);
    expect(await rollbackReviewSnapshot(f.root, f.context.sessionId, id, f.cwd)).toBe("rolled-back");
    expect(await readFile(f.path, "utf8")).toBe("\ufeffbefore\r\n");
    expect((await readReviewSnapshot(f.root, f.context.sessionId, id))?.status).toBe("rolled-back");
    await writeFile(f.path, "new user edit");
    expect(await rollbackReviewSnapshot(f.root, f.context.sessionId, id, f.cwd)).toBe("already-rolled-back");
    expect(await readFile(f.path, "utf8")).toBe("new user edit");
  });
  it("refuses conflicting content and a different workspace", async () => {
    const f = await setup(); const other = await setup(); await writeFile(f.path, "before");
    const result = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, () => writeFile(f.path, "after"));
    const id = String(result?.snapshotId);
    expect(await rollbackReviewSnapshot(f.root, f.context.sessionId, id, other.cwd)).toBe("unavailable");
    await writeFile(f.path, "external edit");
    expect(await rollbackReviewSnapshot(f.root, f.context.sessionId, id, f.cwd)).toBe("conflict");
    expect(await readFile(f.path, "utf8")).toBe("external edit");
  });
  it("removes only the unchanged newly-created file and serializes duplicate requests", async () => {
    const f = await setup();
    const result = await reviewedWrite(f.root, f.path, "file.txt", "new", f.context, () => writeFile(f.path, "new"));
    const id = String(result?.snapshotId);
    const outcomes = await Promise.all([rollbackReviewSnapshot(f.root, f.context.sessionId, id, f.cwd), rollbackReviewSnapshot(f.root, f.context.sessionId, id, f.cwd)]);
    expect(outcomes).toContain("rolled-back"); expect(outcomes.filter(x => x === "rolled-back")).toHaveLength(1);
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reads immutable evidence after later edits and rejects wrong ownership and corruption", async () => {
    const f = await setup(); await writeFile(f.path, "before");
    const result = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, () => writeFile(f.path, "after"));
    const id = String(result?.snapshotId); await writeFile(f.path, "later user edit");
    expect(await readReviewSnapshot(f.root, f.context.sessionId, id)).toMatchObject({ before: "before", after: "after", path: "file.txt" });
    expect(await readReviewSnapshot(f.root, sessionId("other"), id)).toBeUndefined();
    expect(await readReviewSnapshot(f.root, f.context.sessionId, "../../outside")).toBeUndefined();
    await writeFile(join(await snapshot(f.root), "after"), "tampered");
    await expect(readReviewSnapshot(f.root, f.context.sessionId, id)).rejects.toThrow("checksum");
  });
  it("persists original bytes before mutation and links the verified result to its call", async () => {
    const f = await setup(); await writeFile(f.path, "before\r\n");
    const result = await reviewedWrite(f.root, f.path, "file.txt", "after", f.context, async () => {
      const directory = await snapshot(f.root);
      expect(await readFile(join(directory, "before"), "utf8")).toBe("before\r\n");
      expect(JSON.parse(await readFile(join(directory, "meta.json"), "utf8")).status).toBe("prepared");
      await writeFile(f.path, "after");
    });
    expect(result?.status).toBe("applied");
    const record = JSON.parse(await readFile(join(await snapshot(f.root), "meta.json"), "utf8"));
    expect(record).toMatchObject({ callId: "call", sessionId: "../session", existed: true, status: "applied", path: "file.txt" });
    expect(record.beforeHash).not.toBe(record.afterHash);
  });
  it("records new files distinctly from existing empty files", async () => {
    const f = await setup();
    const result = await reviewedWrite(f.root, f.path, "file.txt", "new", f.context, () => writeFile(f.path, "new"));
    expect(result?.beforeHash).toBeNull();
  });
  it("retains a prepared snapshot when the write fails", async () => {
    const f = await setup(); await writeFile(f.path, "original");
    await expect(reviewedWrite(f.root, f.path, "file.txt", "new", f.context, async () => { throw new Error("denied"); })).rejects.toThrow("denied");
    expect(JSON.parse(await readFile(join(await snapshot(f.root), "meta.json"), "utf8")).status).toBe("prepared");
    expect(await readFile(f.path, "utf8")).toBe("original");
  });
  it("does not claim verified application after an external modification", async () => {
    const f = await setup();
    const result = await reviewedWrite(f.root, f.path, "file.txt", "expected", f.context, () => writeFile(f.path, "external"));
    expect(result?.status).toBe("conflict");
  });
  it("reports the size bound instead of promising a nonexistent snapshot", async () => {
    const f = await setup(); const value = "x".repeat(2 * 1024 * 1024 + 1);
    const result = await reviewedWrite(f.root, f.path, "file.txt", value, f.context, () => writeFile(f.path, value));
    expect(result).toMatchObject({ available: false, reason: "snapshot-size-limit" });
    await expect(readdir(f.root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
