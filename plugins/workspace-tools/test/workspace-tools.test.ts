import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionId, toolCallId, type ToolDefinition } from "@piharness/core";
import { createWorkspaceTools } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("workspace tools", () => {
  it("writes, reads, replaces, lists, and searches workspace files", async () => {
    const cwd = await directory();
    await mkdir(join(cwd, "src"));
    const tools = createWorkspaceTools({ enableShell: false });
    await execute(tools, "write_file", cwd, { path: "src/a.txt", content: "hello world" });
    await expect(readFile(join(cwd, "src", "a.txt"), "utf8")).resolves.toBe("hello world");

    const read = await execute(tools, "read_file", cwd, { path: "src/a.txt" });
    expect(read.content).toEqual([{ type: "text", text: "hello world" }]);
    await execute(tools, "replace_text", cwd, { path: "src/a.txt", oldText: "world", newText: "Pi" });
    const listed = await execute(tools, "list_files", cwd, { path: "." });
    expect(listed.content[0]).toMatchObject({ text: "src/a.txt" });
    const searched = await execute(tools, "search_text", cwd, { path: ".", query: "Pi" });
    expect(searched.content[0]).toMatchObject({ text: "src/a.txt:1:hello Pi" });
  });

  it("blocks lexical workspace escapes even without relying on policy", async () => {
    const cwd = await directory();
    const tools = createWorkspaceTools({ enableShell: false });
    await expect(execute(tools, "write_file", cwd, { path: "../outside.txt", content: "no" }))
      .rejects.toThrow("escapes workspace");
  });

  it.skipIf(process.platform === "win32")("blocks symbolic-link workspace escapes", async () => {
    const cwd = await directory();
    const outside = await directory();
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, join(cwd, "escape"), "dir");
    const tools = createWorkspaceTools({ enableShell: false });

    await expect(execute(tools, "read_file", cwd, { path: "escape/secret.txt" }))
      .rejects.toThrow("escapes workspace");
  });

  it("runs an approved shell command and captures output", async () => {
    const cwd = await directory();
    const tools = createWorkspaceTools({ shellTimeoutMs: 5_000 });
    const result = await execute(tools, "shell", cwd, {
      command: `"${process.execPath}" -e "process.stdout.write('ok')"`,
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("ok") });
  });

  it("aborts the shell process tree without leaving a child effect", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "parent.cjs"), `
const { spawn } = require("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(()=>require('node:fs').writeFileSync('orphan.txt','bad'),700)"], { stdio: "ignore" });
setInterval(() => {}, 1000);
`);
    const tool = createWorkspaceTools({ shellTimeoutMs: 5_000 })
      .find((candidate) => candidate.name === "shell");
    if (tool === undefined) throw new Error("Missing shell tool");
    const controller = new AbortController();
    const running = tool.execute({ command: `"${process.execPath}" parent.cjs` }, {
      callId: toolCallId("abort-call"),
      sessionId: sessionId("session"),
      cwd,
      signal: controller.signal,
      reportProgress() {},
    });
    setTimeout(() => controller.abort(new Error("test abort")), 100);
    await expect(running).rejects.toThrow("test abort");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await expect(access(join(cwd, "orphan.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "piharness-tools-"));
  temporary.push(path);
  return path;
}

async function execute(
  tools: readonly ToolDefinition[],
  name: string,
  cwd: string,
  input: Record<string, string>,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`Missing tool ${name}`);
  return tool.execute(input, {
    callId: toolCallId("call"),
    sessionId: sessionId("session"),
    cwd,
    signal: new AbortController().signal,
    reportProgress() {},
  });
}
