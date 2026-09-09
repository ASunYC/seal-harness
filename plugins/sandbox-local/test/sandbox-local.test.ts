import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sessionId, toolCallId } from "@seal-harness/core";
import { createWorkspaceTools } from "@seal-harness/workspace-tools";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSandboxService } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("LocalSandboxService", () => {
  it("wraps explicit runners without shell interpolation", async () => {
    const service = new LocalSandboxService({ runnerCommand: ["runner", "fixed"], platform: "linux" });
    expect(await service.confine(["program", "a b"], { mode: "read-only", workspaceRoot: "/work" })).toMatchObject({ argv: ["runner", "fixed", "--workspace", "/work", "--mode", "read-only", "--", "program", "a b"], enforcement: "full" });
  });

  it("selects bwrap before Landlock and builds the workspace-write mount profile", async () => {
    let landlockProbes = 0;
    const service = new LocalSandboxService({ platform: "linux", probeBwrap: () => true, probeLandlock: () => { landlockProbes += 1; return "full"; } });
    const wrapped = await service.confine(["sh", "-c", "true"], { mode: "workspace-write", workspaceRoot: "/work" });
    expect(wrapped.argv).toEqual(["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent", "--tmpfs", "/tmp", "--bind", "/work", "/work", "--", "sh", "-c", "true"]);
    expect(wrapped.enforcement).toBe("full"); expect(landlockProbes).toBe(0);
  });

  it("falls back to a probed partial Landlock backend and caches selection", async () => {
    let probes = 0;
    const service = new LocalSandboxService({ platform: "linux", probeBwrap: () => false, probeLandlock: () => { probes += 1; return "partial"; }, landlockLauncher: "/landlock-run" });
    const first = await service.confine(["true"], { mode: "read-only", workspaceRoot: "/work" });
    const second = await service.confine(["true"], { mode: "workspace-write", workspaceRoot: "/work" });
    expect(first.argv.slice(0, 4)).toEqual(["/landlock-run", "--ro", "/", "--rw"]);
    expect(second.argv).toContain("/work"); expect(first.enforcement).toBe("partial"); expect(probes).toBe(1);
  });

  it("builds a Seatbelt deny-write profile and fails closed without a Linux backend", async () => {
    const seatbelt = new LocalSandboxService({ platform: "darwin", seatbeltExec: "/sandbox-exec" });
    const wrapped = await seatbelt.confine(["true"], { mode: "read-only", workspaceRoot: "/work" });
    expect(wrapped.argv[0]).toBe("/sandbox-exec"); expect(wrapped.argv[2]).toContain("(deny file-write*)");
    const unavailable = new LocalSandboxService({ platform: "linux", probeBwrap: () => false, probeLandlock: () => "unusable" });
    expect(() => unavailable.confine(["true"], { mode: "read-only", workspaceRoot: "/work" })).toThrow(expect.objectContaining({ code: "SANDBOX_UNAVAILABLE" }));
  });

  it.skipIf(process.platform !== "win32")("enforces real Windows read-only and workspace-write process boundaries", async () => {
    const parent = mkdtempSync(join(process.cwd(), ".artifacts", "sandbox-test-")); roots.push(parent);
    const workspace = join(parent, "workspace"); mkdirSync(workspace);
    const sandbox = new LocalSandboxService();
    const context = { callId: toolCallId("call"), sessionId: sessionId("session"), cwd: workspace, signal: new AbortController().signal, reportProgress() {} };

    const writable = createWorkspaceTools({ sandboxMode: "workspace-write" }, sandbox).find(tool => tool.name === "shell")!;
    const inside = await writable.execute({ command: "echo ok>inside.txt" }, context);
    expect(inside.isError).not.toBe(true);
    expect(readFileSync(join(workspace, "inside.txt"), "utf8").trim()).toBe("ok");

    const readonly = createWorkspaceTools({ sandboxMode: "read-only" }, sandbox).find(tool => tool.name === "shell")!;
    const denied = await readonly.execute({ command: "echo no>denied.txt" }, context);
    expect({ isError: denied.isError, exists: existsSync(join(workspace, "denied.txt")), details: denied.details, content: denied.content }).toMatchObject({ isError: true, exists: false });
    expect(denied.details).toMatchObject({ sandbox: { mode: "read-only", denied: true, enforcement: "partial" } });
  }, 30_000);
});
