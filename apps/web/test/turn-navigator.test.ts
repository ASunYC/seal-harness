import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/turn-navigator.js")).href;

describe("turn navigator", () => {
  it("normalizes wire outline entries, de-duplicates, and sorts zero-based turns", async () => {
    const { normalizeTurnOutline } = await import(moduleUrl);
    expect(normalizeTurnOutline([{ turn: 2, turnId: "c", prompt: 3 }, { turn: 0, turnId: "a", prompt: "first" }, { turn: 2, turnId: "b", response: "last" }, { turn: -1, turnId: "bad" }])).toEqual([
      { turn: 0, turnId: "a", prompt: "first", response: "" },
      { turn: 2, turnId: "b", prompt: "", response: "last" },
    ]);
  });

  it("selects the latest turn crossing the viewport reading line", async () => {
    const { activeTurnFromGeometry } = await import(moduleUrl);
    expect(activeTurnFromGeometry([{ turn: 0, top: 80 }, { turn: 1, top: 131 }, { turn: 2, top: 290 }], 100)).toBe(1);
    expect(activeTurnFromGeometry([], 100)).toBeNull();
  });
});
