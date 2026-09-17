// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
const { subagentTree, subagentElapsed, renderSubagentTree } = await import(pathToFileURL(resolve("apps/web/public/subagent-tree.js")).href);
const child = (id: string, parent: string) => ({ sessionId: id, parentSessionId: parent, label: id, status: "running", model: { provider: "mock", model: "m" } });
describe("subagent call tree", () => {
  it("shows the durable task as bounded text without interpreting HTML", () => {
    const task = "<img src=x onerror=alert(1)>" + "x".repeat(13000);
    const root = renderSubagentTree([{ ...child("one", "root"), task }], "root", { doc: document, locale: "en" });
    expect(root.querySelector(".subagent-task pre")?.textContent).toBe(task.slice(0, 12000));
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("Open the session for the full task.");
    expect(renderSubagentTree([child("old", "root")], "root", { doc: document }).querySelector(".subagent-task")).toBeNull();
  });
  it("connects unsorted descendants and excludes unrelated, duplicate and cyclic records", () => {
    const tree = subagentTree([child("grandchild", "child"), child("child", "root"), child("child", "root"), child("orphan", "missing"), child("a", "b"), child("b", "a"), child("root", "child")], "root");
    expect(tree.map((node: any) => node.sessionId)).toEqual(["child"]);
    expect(tree[0].children.map((node: any) => node.sessionId)).toEqual(["grandchild"]);
  });
  it("uses recorded times and never fabricates elapsed time for unknown or invalid records", () => {
    expect(subagentElapsed({ startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:05Z", status: "completed" })).toBe("1m 5s");
    expect(subagentElapsed({ startedAt: "2026-01-01T00:00:00Z", status: "running" }, Date.parse("2026-01-01T00:00:12Z"))).toBe("12s");
    expect(subagentElapsed({ status: "completed" })).toBeUndefined();
    expect(subagentElapsed({ startedAt: "invalid", status: "running" })).toBeUndefined();
  });
  it("renders nested tasks, safe errors and working session/stop controls", async () => {
    const open = vi.fn(); const abort = vi.fn();
    const root = renderSubagentTree([child("one", "root"), { ...child("two", "one"), status: "failed", error: "<img src=x onerror=alert(1)>" }], "root", { doc: document, locale: "en", onOpen: open, onAbort: abort });
    expect(root.querySelectorAll("ul ul details")).toHaveLength(1);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x");
    const buttons = [...root.querySelectorAll("button")] as HTMLButtonElement[];
    buttons.find(button => button.textContent === "Open session")!.click();
    buttons.find(button => button.textContent === "Stop task")!.click();
    await vi.waitFor(() => expect(abort).toHaveBeenCalledWith("one"));
    expect(open).toHaveBeenCalledWith("one");
    expect(buttons.filter(button => button.textContent === "Stop task")).toHaveLength(1);
  });
});
