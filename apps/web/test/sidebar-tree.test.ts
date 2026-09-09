import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/sidebar-tree.js")).href;

describe("sidebar tree keyboard navigation", () => {
  it("moves without wrapping and supports Home/End", async () => {
    const { treeNavigationIndex } = await import(moduleUrl);
    expect(treeNavigationIndex(4, 1, "ArrowDown")).toBe(2);
    expect(treeNavigationIndex(4, 3, "ArrowDown")).toBe(3);
    expect(treeNavigationIndex(4, 0, "ArrowUp")).toBe(0);
    expect(treeNavigationIndex(4, 2, "Home")).toBe(0);
    expect(treeNavigationIndex(4, 1, "End")).toBe(3);
  });

  it("handles empty trees and an initially missing focus", async () => {
    const { treeNavigationIndex } = await import(moduleUrl);
    expect(treeNavigationIndex(0, -1, "ArrowDown")).toBe(-1);
    expect(treeNavigationIndex(3, -1, "ArrowDown")).toBe(0);
  });

  it("shows the browsing empty state only outside search", async () => {
    const { shouldShowSessionEmptyState } = await import(moduleUrl);
    expect(shouldShowSessionEmptyState(0, "")).toBe(true);
    expect(shouldShowSessionEmptyState(0, "query")).toBe(false);
    expect(shouldShowSessionEmptyState(1, "")).toBe(false);
  });
});
