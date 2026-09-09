import { describe, expect, it } from "vitest";

describe("row action menu keyboard navigation", () => {
  it("wraps arrows and supports Home/End", async () => {
    const { rowActionMenuIndex } = await import(new URL("../public/row-action-menu.js", import.meta.url).href);
    expect(rowActionMenuIndex(3, 2, "ArrowDown")).toBe(0);
    expect(rowActionMenuIndex(3, 0, "ArrowUp")).toBe(2);
    expect(rowActionMenuIndex(3, 1, "Home")).toBe(0);
    expect(rowActionMenuIndex(3, 1, "End")).toBe(2);
  });
  it("does not invent a focus target for an empty menu", async () => {
    const { rowActionMenuIndex } = await import(new URL("../public/row-action-menu.js", import.meta.url).href);
    expect(rowActionMenuIndex(0, -1, "ArrowDown")).toBe(-1);
  });
});
