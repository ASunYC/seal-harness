import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/todo-panel.js")).href;

describe("todo panel model", () => {
  it("keeps valid tasks and summarizes all statuses", async () => {
    const { todoPanelModel } = await import(moduleUrl);
    expect(todoPanelModel([{ content: "done", status: "completed" }, { content: "run", status: "in_progress" }, { content: "wait", status: "pending" }, { content: "bad", status: "unknown" }])).toEqual({
      items: [{ content: "done", status: "completed" }, { content: "run", status: "in_progress" }, { content: "wait", status: "pending" }], completed: 1, active: 1, pending: 1,
    });
  });

  it("hides absent and empty task lists", async () => {
    const { todoPanelModel } = await import(moduleUrl);
    expect(todoPanelModel(null)).toBeNull(); expect(todoPanelModel([])).toBeNull();
  });
});
