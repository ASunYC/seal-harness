import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/plan-control.js")).href;

describe("plan composer control", () => {
  it("uses the host-folded pending target", async () => {
    const { planModeTarget } = await import(moduleUrl);
    expect(planModeTarget(null)).toBe(false);
    expect(planModeTarget({ active: false })).toBe(false);
    expect(planModeTarget({ active: true })).toBe(true);
    expect(planModeTarget({ active: false, pending: true })).toBe(true);
    expect(planModeTarget({ active: true, pending: false })).toBe(true);
    expect(planModeTarget({ active: true, pending: true })).toBe(false);
  });

  it("switches the composer prompt only for the effective plan target", async () => {
    const { planComposerPlaceholder } = await import(moduleUrl);
    expect(planComposerPlaceholder({ active: true }, "default", "plan")).toBe("plan");
    expect(planComposerPlaceholder({ active: false }, "default", "plan")).toBe("default");
  });
});
