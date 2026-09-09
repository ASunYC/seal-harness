import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/pending-interaction.js")).href;

describe("pending composer interaction selection", () => {
  it("selects only the current Session and preserves the oldest waterfall item", async () => {
    const { selectPendingInteraction } = await import(moduleUrl);
    const approvals = [
      { id: "other", sessionId: "s2", createdAt: "2026-01-01T00:00:00Z" },
      { id: "second", sessionId: "s1", createdAt: "2026-01-01T00:00:02Z" },
    ];
    const questions = [{ id: "first", sessionId: "s1", createdAt: "2026-01-01T00:00:01Z" }];
    expect(selectPendingInteraction(approvals, questions, "s1", true)).toMatchObject({ kind: "question", value: { id: "first" } });
    expect(selectPendingInteraction(approvals, questions, "s2", true)).toMatchObject({ kind: "approval", value: { id: "other" } });
    expect(selectPendingInteraction(approvals, questions, null, true)).toBeUndefined();
  });

  it("keeps legacy unscoped approvals limited to the running Session", async () => {
    const { selectPendingInteraction } = await import(moduleUrl);
    const approvals = [{ id: "legacy", createdAt: "2026-01-01T00:00:00Z" }];
    expect(selectPendingInteraction(approvals, [], "s1", false)).toBeUndefined();
    expect(selectPendingInteraction(approvals, [], "s1", true)).toMatchObject({ value: { id: "legacy" } });
  });
});
