import { describe, expect, it } from "vitest";

describe("Session hover relative time", () => {
  it("uses New Session only for a truly blank session", async () => {
    const { sessionDisplayTitle } = await import(new URL("../public/session-hover.js", import.meta.url).href);
    expect(sessionDisplayTitle({ blank: true, preview: "" }, "New session", "Session")).toBe("New session");
    expect(sessionDisplayTitle({ blank: false, preview: "" }, "New session", "Session")).toBe("Session");
    expect(sessionDisplayTitle({ blank: false, preview: "Named" }, "New session", "Session")).toBe("Named");
  });
  it("uses the same compact time buckets as DSH", async () => {
    const { sessionRelativeTime } = await import(new URL("../public/session-hover.js", import.meta.url).href);
    const now = 400 * 86_400_000;
    expect(sessionRelativeTime(now - 59_000, now)).toEqual({ unit: "now", n: 0 });
    expect(sessionRelativeTime(now - 5 * 60_000, now)).toEqual({ unit: "minutes", n: 5 });
    expect(sessionRelativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: "hours", n: 3 });
    expect(sessionRelativeTime(now - 40 * 86_400_000, now)).toEqual({ unit: "months", n: 1 });
    expect(sessionRelativeTime(now - 400 * 86_400_000, now)).toEqual({ unit: "years", n: 1 });
  });
  it("clamps future timestamps to now", async () => {
    const { sessionRelativeTime } = await import(new URL("../public/session-hover.js", import.meta.url).href);
    expect(sessionRelativeTime(2_000, 1_000)).toEqual({ unit: "now", n: 0 });
  });
  it("abbreviates only POSIX home paths", async () => {
    const { abbreviateWorkspaceHomePath } = await import(new URL("../public/session-hover.js", import.meta.url).href);
    expect(abbreviateWorkspaceHomePath("/home/alice/project", "/home/alice/")).toBe("~/project");
    expect(abbreviateWorkspaceHomePath("/home/alice", "/home/alice")).toBe("~");
    expect(abbreviateWorkspaceHomePath("C:\\Users\\alice\\project", "C:\\Users\\alice")).toBe("C:\\Users\\alice\\project");
    expect(abbreviateWorkspaceHomePath("/srv/project", "/home/alice")).toBe("/srv/project");
  });
});
