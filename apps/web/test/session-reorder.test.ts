import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/session-reorder.js")).href;

describe("Session row reordering", () => {
  it("computes adjacent moves and insert-before anchors", async () => {
    const { moveSessionIds, sessionInsertionAnchor } = await import(moduleUrl); const ids = ["a", "b", "c", "d"];
    expect(moveSessionIds(ids, 1, -1)).toEqual(["b", "a", "c", "d"]); expect(sessionInsertionAnchor(ids, 1, -1)).toBe("a");
    expect(moveSessionIds(ids, 1, 1)).toEqual(["a", "c", "b", "d"]); expect(sessionInsertionAnchor(ids, 1, 1)).toBe("d");
    expect(sessionInsertionAnchor(ids, 3, -1)).toBe("c");
  });
  it("computes arbitrary before/after drag drops without crossing accounts", async () => {
    const { dropSessionIds } = await import(moduleUrl); const ids = ["a", "b", "c", "d"];
    expect(dropSessionIds(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]); expect(dropSessionIds(ids, "d", "b", "before")).toEqual(["a", "d", "b", "c"]); expect(dropSessionIds(ids, "a", "a", "before")).toEqual(ids);
  });
  it("applies local Ungrouped preference without dropping new Sessions", async () => {
    const { applyPreferredSessionOrder } = await import(moduleUrl); const sessions = [{ id: "new" }, { id: "a" }, { id: "b" }];
    expect(applyPreferredSessionOrder(sessions, ["b", "a"]).map((item: { id: string }) => item.id)).toEqual(["b", "a", "new"]);
  });
  it("orders by newest update with stable identity ties", async () => {
    const { sortSessionsByUpdated } = await import(moduleUrl); const sessions = [{ id: "b", updatedAt: "2026-01-01" }, { id: "c", updatedAt: "2026-02-01" }, { id: "a", updatedAt: "2026-01-01" }];
    expect(sortSessionsByUpdated(sessions).map((item: { id: string }) => item.id)).toEqual(["c", "a", "b"]);
  });
  it("promotes only the current blank session and respects a manual override", async () => {
    const { promoteBlankSession } = await import(moduleUrl); const sessions = [{ id: "a", blank: false }, { id: "blank", blank: true }, { id: "b", blank: false }];
    expect(promoteBlankSession(sessions, "blank").map((item: { id: string }) => item.id)).toEqual(["blank", "a", "b"]);
    expect(promoteBlankSession(sessions, "blank", true).map((item: { id: string }) => item.id)).toEqual(["a", "blank", "b"]);
    expect(promoteBlankSession(sessions, "a").map((item: { id: string }) => item.id)).toEqual(["a", "blank", "b"]);
  });
});
