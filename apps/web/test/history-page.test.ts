import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/history-page.js")).href;

describe("history paging budgets", () => {
  it("matches the DSH ordinary and turn-jump page sizes", async () => {
    const page = await import(moduleUrl);
    expect(page.HISTORY_PAGE_MESSAGES).toBe(50);
    expect(page.HISTORY_JUMP_MESSAGES).toBe(200);
  });

  it("preserves an explicitly expanded window without inflating a fresh one", async () => {
    const { refreshedHistorySize } = await import(moduleUrl);
    expect(refreshedHistorySize(0)).toBe(50);
    expect(refreshedHistorySize(50)).toBe(50);
    expect(refreshedHistorySize(150)).toBe(150);
  });
});
