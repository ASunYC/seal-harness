import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  contextServiceToken,
  type ContextRequest,
  type ContextService,
  type PiHarnessEvents,
  type PreparedContext,
  type UserMessage,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

export interface FileContextConfig {
  readonly systemPrompt?: string;
  readonly instructionFile?: string;
  readonly maxInstructionBytes?: number;
}

export class FileContextService implements ContextService {
  constructor(readonly config: FileContextConfig = {}) {}

  async prepare(request: ContextRequest): Promise<PreparedContext> {
    request.signal.throwIfAborted();
    const instructions = await loadInstructions(
      request.cwd,
      this.config.instructionFile ?? "AGENTS.md",
      this.config.maxInstructionBytes ?? 65_536,
    );
    const addition: UserMessage = { role: "user", content: request.prompt };
    const sections = [
      this.config.systemPrompt ?? "You are PiHarness, a concise and careful coding agent.",
      ...instructions.map(({ path, content }) => `Project instructions (${path}):\n${content}`),
    ];
    return {
      systemPrompt: sections.join("\n\n"),
      messages: [...request.history, addition],
      additions: [addition],
    };
  }
}

export const fileContextPlugin = definePlugin<FileContextConfig, PiHarnessEvents>({
  name: "context-files",
  provides: [contextServiceToken],
  setup(context, config) {
    context.provide(contextServiceToken, new FileContextService(config));
  },
});

async function loadInstructions(
  cwd: string,
  filename: string,
  maxBytes: number,
): Promise<Array<{ path: string; content: string }>> {
  const root = await findProjectRoot(resolve(cwd));
  const directories: string[] = [];
  let current = resolve(cwd);
  while (true) {
    directories.push(current);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  directories.reverse();

  let remaining = maxBytes;
  const loaded: Array<{ path: string; content: string }> = [];
  for (const directory of directories) {
    if (remaining <= 0) break;
    const path = join(directory, filename);
    try {
      const content = await readFile(path, "utf8");
      const bytes = Buffer.byteLength(content);
      const accepted = bytes <= remaining
        ? content
        : Buffer.from(content).subarray(0, remaining).toString("utf8");
      loaded.push({ path: relative(root, path) || filename, content: accepted });
      remaining -= Buffer.byteLength(accepted);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return loaded;
}

async function findProjectRoot(start: string): Promise<string> {
  let current = start;
  while (true) {
    try {
      await access(join(current, ".git"));
      return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}
