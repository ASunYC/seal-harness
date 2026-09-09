import { describe, expect, it, vi } from "vitest";
import type { LspService } from "@seal-harness/core";
import { formatLocations, lspTool } from "../src/index.js";

describe("lsp tool", () => {
  it("converts model coordinates and renders workspace-relative results", async () => {
    const query = vi.fn(async () => ({ kind: "locations" as const, resolvedWorkspaceUri: "file:///work", locations: [{ uri: "file:///work/src/a.ts", range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } } }] }));
    const tool = lspTool({ query, registerProvider: vi.fn() } as unknown as LspService, { maxLocations: 100, maxResultChars: 1000, timeoutMs: 1000 });
    const result = await tool.execute({ operation: "goToDefinition", file_path: "src/a.ts", line: 3, character: 5 }, { callId: "c" as never, sessionId: "s" as never, cwd: "/work", signal: new AbortController().signal, reportProgress() {} });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ position: { line: 2, character: 4 }, workspaceRoot: "/work" }), expect.any(AbortSignal));
    expect(result.content).toEqual([{ type: "text", text: "src/a.ts:3:5" }]);
  });
  it("caps location count and output length", () => {
    const locations = Array.from({ length: 3 }, (_, line) => ({ uri: "file:///w/a.ts", range: { start: { line, character: 0 }, end: { line, character: 1 } } }));
    expect(formatLocations(locations, "file:///w", 2, 100)).toContain("1 more location omitted");
    expect(formatLocations(locations, "file:///w", 3, 12)).toHaveLength(12);
  });
});
