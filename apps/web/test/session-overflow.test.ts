import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/session-overflow.js")).href;

describe("collapsed Session groups", () => {
  it("shows five ordinary Sessions and reports the hidden count", async () => {
    const { collapsedSessionRows } = await import(moduleUrl); const sessions = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, blank: false }));
    expect(collapsedSessionRows(sessions)).toEqual({ rows: sessions.slice(0, 5), hiddenCount: 3 });
  });
  it("does not charge blank Sessions against the ordinary limit", async () => {
    const { collapsedSessionRows } = await import(moduleUrl); const sessions = [{ id: "blank", blank: true }, ...Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, blank: false }))];
    const result = collapsedSessionRows(sessions); expect(result.rows.map((item: { id: string }) => item.id)).toEqual(["blank", "s0", "s1", "s2", "s3", "s4"]); expect(result.hiddenCount).toBe(1);
  });
});
