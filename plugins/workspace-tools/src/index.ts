import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  text,
  toolServiceToken,
  type ContentBlock,
  type JsonObject,
  type PiHarnessEvents,
  type ToolDefinition,
  type ToolService,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

export interface WorkspaceToolsConfig {
  readonly maxReadBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxListEntries?: number;
  readonly maxSearchMatches?: number;
  readonly shellTimeoutMs?: number;
  readonly enableShell?: boolean;
  readonly ignoredDirectories?: readonly string[];
}

export const workspaceToolsPlugin = definePlugin<WorkspaceToolsConfig, PiHarnessEvents>({
  name: "workspace-tools",
  requires: [toolServiceToken],
  setup(context, config) {
    const tools = createWorkspaceTools(config);
    const registry = context.use(toolServiceToken);
    for (const tool of tools) context.effect(registry.register(tool));
  },
});

export function createWorkspaceTools(config: WorkspaceToolsConfig = {}): ToolDefinition[] {
  const maxReadBytes = config.maxReadBytes ?? 256 * 1024;
  const maxOutputBytes = config.maxOutputBytes ?? 256 * 1024;
  const maxListEntries = config.maxListEntries ?? 2_000;
  const maxSearchMatches = config.maxSearchMatches ?? 200;
  const ignored = new Set(config.ignoredDirectories ?? [".git", "node_modules", "dist", "coverage"]);
  const tools: ToolDefinition[] = [
    {
      name: "read_file",
      description: "Read a UTF-8 text file inside the workspace.",
      inputSchema: objectSchema({ path: stringSchema("Workspace-relative file path") }, ["path"]),
      classify(input, context) {
        return action("read_file", "read", `Read ${stringInput(input, "path")}`, resolve(context.cwd, stringInput(input, "path")));
      },
      async execute(input, context) {
        const path = await existingWorkspacePath(context.cwd, stringInput(input, "path"));
        const data = await readFile(path);
        const truncated = data.length > maxReadBytes;
        const content = data.subarray(0, maxReadBytes).toString("utf8");
        return {
          content: [text(truncated ? `${content}\n\n[truncated at ${maxReadBytes} bytes]` : content)],
          details: { path: relativePath(context.cwd, path), bytes: data.length, truncated },
        };
      },
    },
    {
      name: "write_file",
      description: "Create or replace a UTF-8 text file inside an existing workspace directory.",
      inputSchema: objectSchema({
        path: stringSchema("Workspace-relative file path"),
        content: stringSchema("Complete new file content"),
      }, ["path", "content"]),
      classify(input, context) {
        return action("write_file", "workspace-write", `Write ${stringInput(input, "path")}`, resolve(context.cwd, stringInput(input, "path")));
      },
      async execute(input, context) {
        const path = await writableWorkspacePath(context.cwd, stringInput(input, "path"));
        const content = stringInput(input, "content");
        await writeFile(path, content, "utf8");
        return {
          content: [text(`Wrote ${Buffer.byteLength(content)} bytes to ${relativePath(context.cwd, path)}`)],
          details: { path: relativePath(context.cwd, path), bytes: Buffer.byteLength(content) },
        };
      },
    },
    {
      name: "replace_text",
      description: "Replace one unique literal string in a UTF-8 workspace file.",
      inputSchema: objectSchema({
        path: stringSchema("Workspace-relative file path"),
        oldText: stringSchema("Exact text to replace"),
        newText: stringSchema("Replacement text"),
      }, ["path", "oldText", "newText"]),
      classify(input, context) {
        return action("replace_text", "workspace-write", `Edit ${stringInput(input, "path")}`, resolve(context.cwd, stringInput(input, "path")));
      },
      async execute(input, context) {
        const path = await existingWorkspacePath(context.cwd, stringInput(input, "path"));
        const oldText = stringInput(input, "oldText");
        const newText = stringInput(input, "newText");
        if (oldText.length === 0) throw new Error("oldText must not be empty");
        const content = await readFile(path, "utf8");
        const first = content.indexOf(oldText);
        if (first < 0) throw new Error("oldText was not found");
        if (content.indexOf(oldText, first + oldText.length) >= 0) {
          throw new Error("oldText is not unique");
        }
        const updated = content.slice(0, first) + newText + content.slice(first + oldText.length);
        await writeFile(path, updated, "utf8");
        return {
          content: [text(`Updated ${relativePath(context.cwd, path)}`)],
          details: { path: relativePath(context.cwd, path) },
        };
      },
    },
    {
      name: "make_directory",
      description: "Create a directory inside the workspace.",
      inputSchema: objectSchema({ path: stringSchema("Workspace-relative directory path") }, ["path"]),
      classify(input, context) {
        return action("make_directory", "workspace-write", `Create directory ${stringInput(input, "path")}`, resolve(context.cwd, stringInput(input, "path")));
      },
      async execute(input, context) {
        const requested = resolve(context.cwd, stringInput(input, "path"));
        await assertLexicalWithin(context.cwd, requested);
        const ancestor = await nearestExistingAncestor(dirname(requested));
        await assertRealWithin(context.cwd, ancestor);
        await mkdir(requested, { recursive: true });
        await assertRealWithin(context.cwd, await realpath(requested));
        return { content: [text(`Created ${relativePath(context.cwd, requested)}`)] };
      },
    },
    {
      name: "list_files",
      description: "List files recursively inside a workspace directory.",
      inputSchema: objectSchema({ path: stringSchema("Workspace-relative directory path, defaults to .") }, []),
      classify(input, context) {
        const requested = optionalStringInput(input, "path") ?? ".";
        return action("list_files", "read", `List ${requested}`, resolve(context.cwd, requested));
      },
      async execute(input, context) {
        const root = await existingWorkspacePath(context.cwd, optionalStringInput(input, "path") ?? ".");
        const files = await walk(root, ignored, maxListEntries);
        return {
          content: [text(files.map((path) => relativePath(context.cwd, path)).join("\n"))],
          details: { count: files.length, truncated: files.length >= maxListEntries },
        };
      },
    },
    {
      name: "search_text",
      description: "Search for a literal string in UTF-8 workspace files.",
      inputSchema: objectSchema({
        query: stringSchema("Literal text to find"),
        path: stringSchema("Workspace-relative directory path, defaults to ."),
      }, ["query"]),
      classify(input, context) {
        const requested = optionalStringInput(input, "path") ?? ".";
        return action("search_text", "read", `Search ${requested}`, resolve(context.cwd, requested));
      },
      async execute(input, context) {
        const query = stringInput(input, "query");
        if (query.length === 0) throw new Error("query must not be empty");
        const root = await existingWorkspacePath(context.cwd, optionalStringInput(input, "path") ?? ".");
        const files = await walk(root, ignored, maxListEntries);
        const matches: string[] = [];
        for (const path of files) {
          if (matches.length >= maxSearchMatches) break;
          const info = await stat(path);
          if (info.size > maxReadBytes) continue;
          const buffer = await readFile(path);
          if (buffer.includes(0)) continue;
          const lines = buffer.toString("utf8").split(/\r?\n/);
          for (const [index, line] of lines.entries()) {
            if (line.includes(query)) {
              matches.push(`${relativePath(context.cwd, path)}:${index + 1}:${line}`);
              if (matches.length >= maxSearchMatches) break;
            }
          }
        }
        return {
          content: [text(matches.join("\n"))],
          details: { count: matches.length, truncated: matches.length >= maxSearchMatches },
        };
      },
    },
  ];

  if (config.enableShell !== false) {
    tools.push({
      name: "shell",
      description: "Run a shell command in the workspace. This always requires dangerous-operation policy.",
      inputSchema: objectSchema({ command: stringSchema("Shell command") }, ["command"]),
      classify(input, context) {
        return action("shell", "dangerous", `Run shell command: ${stringInput(input, "command")}`, context.cwd);
      },
      async execute(input, context) {
        const root = await realpath(context.cwd);
        const result = await runShell(
          stringInput(input, "command"),
          root,
          context.signal,
          config.shellTimeoutMs ?? 60_000,
          maxOutputBytes,
        );
        const rendered = [
          result.stdout.length === 0 ? "" : `stdout:\n${result.stdout}`,
          result.stderr.length === 0 ? "" : `stderr:\n${result.stderr}`,
          `exit code: ${result.exitCode ?? "terminated"}`,
          result.timedOut ? "timed out" : "",
        ].filter(Boolean).join("\n\n");
        return {
          content: [text(rendered)],
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated,
          },
          isError: result.exitCode !== 0,
        };
      },
    });
  }
  return tools;
}

interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

async function runShell(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
  maxBytes: number,
): Promise<ShellResult> {
  signal.throwIfAborted();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;

    const collect = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> => {
      if (current.length >= maxBytes) {
        truncated = true;
        return current;
      }
      const remaining = maxBytes - current.length;
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });

    const terminate = (): void => terminateTree(child);
    const onAbort = (): void => terminate();
    signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("Shell command aborted"));
        return;
      }
      resolvePromise({
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        exitCode,
        timedOut,
        truncated,
      });
    });
  });
}

function terminateTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("close", () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
    killer.unref();
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

async function walk(root: string, ignored: ReadonlySet<string>, max: number): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0 && files.length < max) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= max) break;
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files.sort();
}

async function existingWorkspacePath(cwd: string, requested: string): Promise<string> {
  const candidate = resolve(cwd, requested);
  await assertLexicalWithin(cwd, candidate);
  const actual = await realpath(candidate);
  await assertRealWithin(cwd, actual);
  return actual;
}

async function writableWorkspacePath(cwd: string, requested: string): Promise<string> {
  const candidate = resolve(cwd, requested);
  await assertLexicalWithin(cwd, candidate);
  const parent = await realpath(dirname(candidate));
  await assertRealWithin(cwd, parent);
  try {
    const actual = await realpath(candidate);
    await assertRealWithin(cwd, actual);
    return actual;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return candidate;
  }
}

async function assertLexicalWithin(cwd: string, candidate: string): Promise<void> {
  assertWithin(resolve(cwd), candidate);
}

async function assertRealWithin(cwd: string, candidate: string): Promise<void> {
  assertWithin(await realpath(cwd), candidate);
}

function assertWithin(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new Error(`Path escapes workspace: ${candidate}`);
  }
}

async function nearestExistingAncestor(start: string): Promise<string> {
  let current = start;
  while (true) {
    try { return await realpath(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`No existing ancestor for ${start}`);
    current = parent;
  }
}

function action(toolName: string, risk: "read" | "workspace-write" | "dangerous", summary: string, target: string) {
  return { kind: "tool" as const, toolName, risk, summary, target };
}

function objectSchema(properties: JsonObject, required: readonly string[]): JsonObject {
  return { type: "object", properties, required, additionalProperties: false };
}

function stringSchema(description: string): JsonObject {
  return { type: "string", description };
}

function stringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string`);
  return value;
}

function optionalStringInput(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${key} must be a string`);
  return value;
}

function relativePath(cwd: string, path: string): string {
  return relative(realpathSync.native(cwd), path).split(sep).join("/") || ".";
}
