import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/goal-bar.js")).href;

describe("goal bar model", () => {
  it("projects phase-specific actions for active and paused goals", async () => {
    const { goalBarModel } = await import(moduleUrl);
    expect(goalBarModel({ id: "g", revision: 1, objective: "Ship", phase: "active" })).toMatchObject({ canPause: true, canResume: false });
    expect(goalBarModel({ id: "g", revision: 2, objective: "Ship", phase: "paused" })).toMatchObject({ canPause: false, canResume: true });
  });

  it("hides absent, completed, and malformed goals", async () => {
    const { goalBarModel } = await import(moduleUrl);
    expect(goalBarModel(null)).toBeNull();
    expect(goalBarModel({ id: "g", revision: 3, objective: "Ship", phase: "complete" })).toBeNull();
    expect(goalBarModel({ id: "g", revision: 3, objective: "", phase: "active" })).toBeNull();
  });
});
