import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/session-search.js")).href;

describe("Session search input contract", () => {
  it("removes NUL and enforces the 500-code-unit wire bound", async () => {
    const { sanitizeSessionSearchQuery } = await import(moduleUrl);
    expect(sanitizeSessionSearchQuery("a\0b")).toBe("ab"); expect(sanitizeSessionSearchQuery("x".repeat(501))).toHaveLength(500);
  });
  it("does not split a surrogate pair at the boundary", async () => {
    const { sanitizeSessionSearchQuery } = await import(moduleUrl); const value = `${"x".repeat(499)}😀tail`;
    expect(sanitizeSessionSearchQuery(value)).toBe("x".repeat(499));
  });
  it("finds local title, id, cwd, and workspace metadata immediately", async () => {
    const { localSessionSearchResults } = await import(moduleUrl);
    const sessions = [{ id: "session-alpha", preview: "Fix parser", cwd: "/repo/alpha" }, { id: "session-beta", preview: "Docs", cwd: "/repo/beta" }];
    const workspaces = [{ id: "ws", title: "Compiler", path: "/repo/alpha", sessionIds: ["session-alpha"] }];
    expect(localSessionSearchResults(sessions, workspaces, "compiler").map((item: { sessionId: string }) => item.sessionId)).toEqual(["session-alpha"]);
    expect(localSessionSearchResults(sessions, workspaces, "SESSION-BETA").map((item: { sessionId: string }) => item.sessionId)).toEqual(["session-beta"]);
  });
  it("excludes the provisional blank New Session from local search", async () => {
    const { localSessionSearchResults } = await import(moduleUrl);
    expect(localSessionSearchResults([{ id: "session-new", preview: "", cwd: "/repo", blank: true }], [], "session-new")).toEqual([]);
  });
  it("keeps local order and deduplicates remote content hits", async () => {
    const { mergeSessionSearchResults } = await import(moduleUrl);
    expect(mergeSessionSearchResults([{ sessionId: "a", workspace: "Compiler", snippet: "", local: true }], [{ sessionId: "a", snippet: "Body" }, { sessionId: "b", snippet: "Remote" }])).toEqual([
      { sessionId: "a", workspace: "Compiler", snippet: "Body", local: true }, { sessionId: "b", snippet: "Remote" },
    ]);
  });
  it("dismisses an empty expanded search only for an outside gesture", async () => {
    const { shouldDismissSessionSearch } = await import(moduleUrl);
    expect(shouldDismissSessionSearch(true, "   ", false)).toBe(true);
    expect(shouldDismissSessionSearch(true, "query", false)).toBe(false);
    expect(shouldDismissSessionSearch(true, "", true)).toBe(false);
    expect(shouldDismissSessionSearch(false, "", false)).toBe(false);
  });
});
