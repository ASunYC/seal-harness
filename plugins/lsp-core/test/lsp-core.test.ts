import { describe, expect, it, vi } from "vitest";
import { LspError } from "@seal-harness/core";
import { DefaultLspService, finalExtension } from "../src/index.js";

describe("DefaultLspService", () => {
  it("selects providers by normalized final extension and releases atomically", async () => {
    const service = new DefaultLspService();
    const query = vi.fn(async (request) => ({ kind: "hover" as const, hover: { contents: request.languageId } }));
    const dispose = service.registerProvider({ id: "ts", extensionToLanguage: { TS: "typescript" }, query });
    await expect(service.query({ operation: "hover", filePath: "x.d.TS", position: { line: 0, character: 0 }, workspaceRoot: "/w" })).resolves.toEqual({ kind: "hover", hover: { contents: "typescript" } });
    dispose();
    await expect(service.query({ operation: "hover", filePath: "x.ts", position: { line: 0, character: 0 }, workspaceRoot: "/w" })).rejects.toMatchObject({ code: "LSP_UNAVAILABLE" });
  });
  it("rejects conflicting and partial registrations", async () => {
    const service = new DefaultLspService();
    service.registerProvider({ id: "one", extensionToLanguage: { ".ts": "typescript" }, query: vi.fn() });
    expect(() => service.registerProvider({ id: "two", extensionToLanguage: { ".js": "javascript", ".TS": "typescript" }, query: vi.fn() })).toThrow(LspError);
    await expect(service.query({ operation: "hover", filePath: "x.js", position: { line: 0, character: 0 }, workspaceRoot: "/w" })).rejects.toThrow("no LSP provider");
  });
  it("handles dotfiles and Windows separators", () => { expect(finalExtension("C:\\x\\Foo.TS")).toBe(".ts"); expect(finalExtension(".bashrc")).toBe(""); });
});
