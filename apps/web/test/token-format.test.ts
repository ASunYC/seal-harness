import { describe, expect, it } from "vitest";
import { formatCacheHitPercent, formatCompactDuration, formatCompactTokens, formatExactTokenCount, formatLatencySeconds, formatRunDuration, formatTokensPerSecond, promptTokensForUsage } from "../public/token-format.js";

describe("turn token formatting", () => {
  it("formats ordinary, empty, and complete cache-hit ratios", () => {
    expect(formatCacheHitPercent(1, 4, 1)).toBe("25"); expect(formatCacheHitPercent(0, 0, 1)).toBeNull(); expect(formatCacheHitPercent(10, 10, 1)).toBe("100");
  });
  it("does not round a partial cache hit up to 100 percent", () => {
    expect(formatCacheHitPercent(9999, 10000, 1)).toBe("99.99");
  });
  it("uses the exact prompt total when unclassified prompt tokens exist", () => {
    const usage = { inputTokens: 12, outputTokens: 3, totalTokens: 20, cacheReadTokens: 4 };
    expect(promptTokensForUsage(usage)).toBe(17);
    expect(formatCacheHitPercent(usage.cacheReadTokens, promptTokensForUsage(usage), 1)).toBe("23.5");
    expect(promptTokensForUsage({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 })).toBe(16);
  });
  it("formats run duration, latency, and throughput with their distinct upstream precision", () => {
    expect(formatRunDuration(9_999)).toBe("9s");
    expect(formatRunDuration(59_999)).toBe("59s");
    expect(formatRunDuration(61_999)).toBe("1m 01s");
    expect(formatLatencySeconds(9_949)).toBe("9.9");
    expect(formatLatencySeconds(10_499)).toBe("10");
    expect(formatTokensPerSecond(9.94)).toBe("9.9");
    expect(formatTokensPerSecond(10.49)).toBe("10");
  });
  it("uses the upstream K/M thresholds and localized templates", () => {
    expect(formatCompactTokens(517)).toBe("517");
    expect(formatCompactTokens(12_200)).toBe("12.2K");
    expect(formatCompactTokens(517_000)).toBe("517K");
    expect(formatCompactTokens(1_200_000)).toBe("1.2M");
    expect(formatCompactTokens(12_200, "{value} thousand", "{value} million")).toBe("12.2 thousand");
  });
  it("groups exact token counts without depending on the host locale", () => {
    expect(formatExactTokenCount(517)).toBe("517");
    expect(formatExactTokenCount(1_234_567)).toBe("1,234,567");
    expect(formatExactTokenCount(1_234_567, "·")).toBe("1·234·567");
  });
  it("formats the compact session-level durations", () => {
    expect(formatCompactDuration(45_240)).toBe("45.2s");
    expect(formatCompactDuration(162_000)).toBe("2m42s");
    expect(formatCompactDuration(162_000, "{seconds}秒", "{minutes}分{seconds}秒")).toBe("2分42秒");
  });
});
