import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const { startBackend } = await import(pathToFileURL(resolve("apps/desktop/src/host.mjs")).href);
describe("desktop backend lifecycle", () => {
  it("forces an unresponsive owned backend to exit and shares the stop promise", async () => {
    const backend = startBackend({ execPath: process.execPath, entry: resolve("apps/desktop/test/fixtures/stubborn-backend.mjs"), cwd: process.cwd(), dataHome: process.cwd(), shutdownTimeoutMs: 100 });
    try {
      await backend.ready;
      const first = backend.stop(); expect(backend.stop()).toBe(first);
      await first;
      expect(backend.child.exitCode !== null || backend.child.signalCode !== null).toBe(true);
      if (process.platform !== "win32") expect(backend.child.signalCode).toBe("SIGKILL");
    } finally { await backend.stop(); }
  });
  it("cleans up startup listeners and the child after a readiness deadline", async () => {
    const backend = startBackend({ execPath: process.execPath, entry: resolve("apps/desktop/test/fixtures/stubborn-backend.mjs"), cwd: process.cwd(), dataHome: process.cwd(), timeoutMs: 50, shutdownTimeoutMs: 100 });
    await expect(backend.ready).rejects.toThrow("startup timed out");
    expect(backend.child.exitCode !== null || backend.child.signalCode !== null).toBe(true);
    expect(backend.child.listenerCount("message")).toBe(0);
  });
  it("exchanges auth, isolates data from workspace and shuts down over IPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-desktop-test-"));
    const cwd = join(root, "workspace"); const dataHome = join(root, "user-data");
    await mkdir(cwd);
    const backend = startBackend({ execPath: process.execPath, entry: resolve("apps/desktop/src/backend.mjs"), cwd, dataHome });
    try {
      const launch = await backend.ready;
      const origin = new URL(launch).origin;
      expect((await fetch(origin)).status).toBe(401);
      const exchange = await fetch(launch, { redirect: "manual" });
      expect(exchange.status).toBe(303);
      expect(exchange.headers.get("location")).toBe("/");
      const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
      const response = await fetch(origin, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Seal Harness");
      expect(await readdir(cwd)).toEqual([]);
      expect(await readdir(dataHome)).toContain("web-auth-token");
      await backend.stop();
      expect(backend.child.exitCode).toBe(0);
      await expect(fetch(origin)).rejects.toThrow();
      await backend.stop();
    } finally { await backend.stop(); await rm(root, { recursive: true, force: true }); }
  }, 60_000);
  it("rejects failed startup without leaving a child running", async () => {
    const backend = startBackend({ execPath: process.execPath, entry: resolve("apps/desktop/missing-entry.mjs"), cwd: process.cwd(), dataHome: process.cwd(), timeoutMs: 2_000 });
    await expect(backend.ready).rejects.toThrow("exited during startup");
    expect(backend.child.exitCode).not.toBeNull();
  });
});
