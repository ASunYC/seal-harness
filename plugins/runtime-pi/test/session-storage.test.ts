import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openNativeSession } from "../src/session-storage.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    }
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "seal-pi-lease-test-")); roots.push(root);
  return root;
}
async function owner(root: string) {
  const child = fork(new URL("./fixtures/native-session-owner.mjs", import.meta.url), [root], {
    execArgv: ["--experimental-strip-types"], silent: true,
  });
  children.push(child);
  let stderr = ""; child.stderr?.on("data", chunk => { stderr += chunk; });
  const ready = await new Promise<{ ready?: boolean; error?: string }>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`Child startup timed out: ${stderr}`)), 10000);
    child.once("message", value => { clearTimeout(timer); accept(value as { ready?: boolean; error?: string }); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Child exited ${code}: ${stderr}`)); });
  });
  expect(ready.error).toBeUndefined(); expect(ready.ready).toBe(true);
  return child;
}

describe.skipIf(process.platform !== "win32" && process.platform !== "linux")("native session process leases", () => {
  it("rejects a live separate process and restores its JSONL after forced exit", async () => {
    const root = await fixture();
    const child = await owner(root);
    await expect(openNativeSession(root, "process-test", root)).rejects.toThrow("writer lease");
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    const name = createHash("sha256").update("process-test").digest("hex");
    const file = join(root, "pi-sessions", `${name}.jsonl`);
    const before = await readFile(file, "utf8");
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => openNativeSession(root, "process-test", root)));
    const winners = attempts.filter(result => result.status === "fulfilled");
    try {
      expect(winners).toHaveLength(1);
      expect(JSON.stringify(winners[0]!.value.manager.buildSessionContext())).toContain("persisted answer");
      expect(await readFile(file, "utf8")).toBe(before);
    } finally { for (const winner of winners) await winner.value.release(); }
    const resumed = await openNativeSession(root, "process-test", root); await resumed.release();
  }, 15000);

  it("releases across processes normally and keeps unrelated sessions independent", async () => {
    const root = await fixture(); const child = await owner(root);
    const other = await openNativeSession(root, "different-session", root); await other.release();
    const exited = once(child, "exit"); child.send("release"); await exited;
    const reopened = await openNativeSession(root, "process-test", root); await reopened.release();
  }, 15000);

  it("retains ambiguous legacy leases and releases the OS guard after initialization fails", async () => {
    const root = await fixture();
    const initial = await openNativeSession(root, "process-test", root); await initial.release();
    const name = createHash("sha256").update("process-test").digest("hex");
    const path = join(root, "pi-sessions", `${name}.lease`);
    await writeFile(path, "incomplete");
    for (let i = 0; i < 2; i++) await expect(openNativeSession(root, "process-test", root)).rejects.toThrow("unreadable");
    expect(await readFile(path, "utf8")).toBe("incomplete");
    await writeFile(path, JSON.stringify({ pid: process.pid, sealSessionId: "process-test" }));
    await expect(openNativeSession(root, "process-test", root)).rejects.toThrow("active legacy writer");
  });
});
