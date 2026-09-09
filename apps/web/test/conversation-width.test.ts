import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/conversation-width.js")).href;

describe("DSH-compatible conversation content width", () => {
  it("uses the adaptive default and clamps persisted preferences to the live column", async () => {
    const { resolveContentWidth } = await import(moduleUrl);
    expect(resolveContentWidth(1_500, null)).toBe(920);
    expect(resolveContentWidth(1_100, null)).toBe(704);
    expect(resolveContentWidth(1_000, 900)).toBe(824);
    expect(resolveContentWidth(1_400, 500)).toBe(640);
    expect(resolveContentWidth(600, 900)).toBe(640);
  });
});
