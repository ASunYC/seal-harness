import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionId, text } from "@piharness/core";
import { FileContextService } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("FileContextService", () => {
  it("loads root-to-leaf AGENTS.md files and declares the user addition", async () => {
    const root = await mkdtemp(join(tmpdir(), "piharness-context-"));
    temporary.push(root);
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "packages", "app"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root rules");
    await writeFile(join(root, "packages", "app", "AGENTS.md"), "app rules");
    const service = new FileContextService({ systemPrompt: "base" });

    const prepared = await service.prepare({
      sessionId: sessionId("session"),
      cwd: join(root, "packages", "app"),
      prompt: [text("hello")],
      history: [],
      signal: new AbortController().signal,
    });

    expect(prepared.systemPrompt).toContain("root rules");
    expect(prepared.systemPrompt).toContain("app rules");
    expect(prepared.systemPrompt.indexOf("root rules")).toBeLessThan(prepared.systemPrompt.indexOf("app rules"));
    expect(prepared.additions).toEqual([{ role: "user", content: [text("hello")] }]);
    expect(prepared.messages).toEqual(prepared.additions);
  });
});
