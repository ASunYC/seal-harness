import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/session-ancestry.js")).href;

describe("Session ancestry", () => {
  it("derives the root-to-current chain for nested subagents", async () => {
    const { deriveSessionAncestry } = await import(moduleUrl);
    const sessions = [
      { id: "root", preview: "Root" },
      { id: "child", preview: "Research", origin: "subagent", parentSessionId: "root" },
      { id: "leaf", preview: "Verify", origin: "subagent", parentSessionId: "child" },
    ];
    expect(deriveSessionAncestry(sessions, "leaf")).toEqual([
      { id: "root", displayTitle: "Root", subagent: false },
      { id: "child", displayTitle: "Research", subagent: true },
      { id: "leaf", displayTitle: "Verify", subagent: true },
    ]);
  });
  it("falls back safely for missing sessions and stops cycles", async () => {
    const { deriveSessionAncestry } = await import(moduleUrl);
    expect(deriveSessionAncestry([], "missing")).toEqual([{ id: "missing", displayTitle: "missing", subagent: false }]);
    const cycle = [{ id: "a", origin: "subagent", parentSessionId: "b" }, { id: "b", origin: "subagent", parentSessionId: "a" }];
    expect(deriveSessionAncestry(cycle, "a")).toHaveLength(2);
  });
});
