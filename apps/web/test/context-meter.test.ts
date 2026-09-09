import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/context-meter.js")).href;

describe("context occupancy", () => {
  it("prefers projected usage and clamps the display percent", async () => {
    const { contextOccupancy } = await import(moduleUrl);
    expect(contextOccupancy({ pressureTokens: 20, projectedTokens: 55, contextWindow: 100 })).toEqual({ usedTokens: 55, contextWindow: 100, percent: 55 });
    expect(contextOccupancy({ pressureTokens: 120, contextWindow: 100 })?.percent).toBe(100);
  });

  it("stays hidden until both usage and capacity are valid", async () => {
    const { contextOccupancy } = await import(moduleUrl);
    expect(contextOccupancy({ pressureTokens: 20 })).toBeNull();
    expect(contextOccupancy({ pressureTokens: -1, contextWindow: 100 })).toBeNull();
  });
});
