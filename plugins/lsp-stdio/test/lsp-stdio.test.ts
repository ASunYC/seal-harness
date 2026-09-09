import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { StdioLspProvider } from "../src/index.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixture-server.mjs");
const config = { command: process.execPath, args: [fixture], env: {}, extensionToLanguage: { ".ts": "typescript" }, initializationOptions: null, configuration: null, maxMessageBytes: 1_000_000, maxStderrBytes: 10_000, maxDocumentBytes: 10_000, shutdownTimeoutMs: 1_000, killGraceMs: 1_000 } as const;

describe("StdioLspProvider", () => {
  it("initializes lazily and runs transient navigation and hover queries", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-lsp-")); cleanup.push(() => rm(cwd, { recursive: true, force: true })); await writeFile(join(cwd, "a.ts"), "const answer = 42;\n");
    const provider = new StdioLspProvider("fixture", config); cleanup.push(() => provider.dispose());
    await expect(provider.query({ operation: "goToDefinition", filePath: "a.ts", workspaceRoot: cwd, languageId: "typescript", position: { line: 0, character: 6 } })).resolves.toMatchObject({ kind: "locations", locations: [{ range: { start: { line: 0, character: 6 } } }] });
    await expect(provider.query({ operation: "hover", filePath: "a.ts", workspaceRoot: cwd, languageId: "typescript", position: { line: 0, character: 6 } })).resolves.toMatchObject({ kind: "hover", hover: { contents: "```ts\nconst answer: number\n```\n\ndocs" } });
  });
  it("rejects sources outside the canonical workspace before spawning", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-lsp-in-")); const outside = await mkdtemp(join(tmpdir(), "seal-lsp-out-")); cleanup.push(() => rm(cwd, { recursive: true, force: true })); cleanup.push(() => rm(outside, { recursive: true, force: true })); await writeFile(join(outside, "a.ts"), "x");
    const provider = new StdioLspProvider("fixture", config); cleanup.push(() => provider.dispose());
    await expect(provider.query({ operation: "hover", filePath: join(outside, "a.ts"), workspaceRoot: cwd, languageId: "typescript", position: { line: 0, character: 0 } })).rejects.toMatchObject({ code: "LSP_SOURCE_OUTSIDE_WORKSPACE" });
  });
});
