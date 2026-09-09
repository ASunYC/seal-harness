import { describe, expect, it } from "vitest";

describe("message clock", () => {
  it("formats same-day, same-year, and cross-year timestamps like DSH", async () => {
    const { formatMessageClock } = await import(new URL("../public/message-clock.js", import.meta.url).href);
    const now = new Date(2026, 8, 6, 20, 0).getTime();
    expect(formatMessageClock(new Date(2026, 8, 6, 5, 7).getTime(), "en", now)).toBe("05:07");
    expect(formatMessageClock(new Date(2026, 0, 2, 5, 7).getTime(), "en", now)).toBe("1/2 05:07");
    expect(formatMessageClock(new Date(2025, 0, 2, 5, 7).getTime(), "en", now)).toBe("2025-1-2 05:07");
    expect(formatMessageClock(new Date(2026, 0, 2, 5, 7).getTime(), "zh-CN", now)).toBe("1月2日 05:07");
    expect(formatMessageClock(new Date(2025, 0, 2, 5, 7).getTime(), "zh-CN", now)).toBe("2025年1月2日 05:07");
  });

  it("computes the local day and the exact next-midnight delay", async () => {
    const { msUntilNextLocalMidnight, startOfLocalDay } = await import(new URL("../public/message-clock.js", import.meta.url).href);
    const now = new Date(2026, 8, 6, 23, 59, 59, 250).getTime();
    expect(startOfLocalDay(now)).toBe(new Date(2026, 8, 6, 0, 0, 0, 0).getTime());
    expect(msUntilNextLocalMidnight(now)).toBe(750);
  });
});
