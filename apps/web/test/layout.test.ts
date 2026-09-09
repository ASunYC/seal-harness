import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/layout.js")).href;

describe("DSH-compatible Web layout", () => {
  it("follows the sidebar/detail concession chain", async () => {
    const { computeColumns } = await import(moduleUrl);
    expect(computeColumns(1_600, 280, 360)).toEqual({ sidebar: 280, center: 960, details: 360 });
    expect(computeColumns(1_250, 280, 360)).toEqual({ sidebar: 280, center: 640, details: 330 });
    expect(computeColumns(1_100, 280, 360)).toEqual({ sidebar: 280, center: 820, details: 0 });
    expect(computeColumns(900, 0, 360)).toEqual({ sidebar: 56, center: 844, details: 0 });
  });

  it("auto-collapses below the DSH large breakpoint while allowing a narrow override", async () => {
    const { effectiveSidebarCollapsed } = await import(moduleUrl);
    expect(effectiveSidebarCollapsed(1_023, false, false)).toBe(true);
    expect(effectiveSidebarCollapsed(1_023, false, true)).toBe(false);
    expect(effectiveSidebarCollapsed(1_024, false, false)).toBe(false);
    expect(effectiveSidebarCollapsed(1_024, true, true)).toBe(true);
  });
});
