// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/input-trigger-menu.js")).href;

describe("input trigger menu", () => {
  it("renders one selected option and keeps the active descendant in sync", async () => {
    const { renderInputTriggerOptions, syncInputTriggerSelection } = await import(moduleUrl);
    const dom = globalThis as any;
    dom.document.body.innerHTML = '<textarea aria-controls="input-trigger-menu"></textarea><div id="input-trigger-menu"></div>';
    const menu = dom.document.querySelector("div"); const accept = vi.fn();
    renderInputTriggerOptions(menu, [{ name: "src", source: "files" }, { name: "Research notes", description: "session" }], accept);
    const options = [...menu.querySelectorAll("button")];
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(dom.document.querySelector("textarea")?.getAttribute("aria-activedescendant")).toBe(options[0].id);
    syncInputTriggerSelection(menu, 1);
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(dom.document.querySelector("textarea")?.getAttribute("aria-activedescendant")).toBe(options[1].id);
    options[1].dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(accept).toHaveBeenCalledWith({ name: "Research notes", description: "session" });
  });

  it("uses Tab only for directory drill and Enter for settling picks", async () => {
    const { inputTriggerKeyAction } = await import(moduleUrl);
    expect(inputTriggerKeyAction("ArrowUp")).toBe("previous");
    expect(inputTriggerKeyAction("ArrowDown")).toBe("next");
    expect(inputTriggerKeyAction("Enter", { drill: true })).toBe("accept");
    expect(inputTriggerKeyAction("Tab", { drill: true })).toBe("drill");
    expect(inputTriggerKeyAction("Tab", { drill: false })).toBeUndefined();
    expect(inputTriggerKeyAction("Escape")).toBe("dismiss");
  });

  it("detects plain and open quoted @ references without triggering inside words", async () => {
    const { detectActiveAtTrigger } = await import(moduleUrl);
    expect(detectActiveAtTrigger("  @src/fi", 9)).toEqual({ trigger: "@", query: "src/fi", quoted: false, position: "leading", start: 2, end: 9 });
    expect(detectActiveAtTrigger('ask @"docs/a b', 14)).toEqual({ trigger: "@", query: "docs/a b", quoted: true, position: "inline", start: 4, end: 14 });
    expect(detectActiveAtTrigger("user@example.com", 16)).toBeUndefined();
    expect(detectActiveAtTrigger('@"closed" tail', 14)).toBeUndefined();
  });
});
