import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/job-control.js")).href;

describe("job header control", () => {
  it("orders live jobs oldest-first and settled jobs newest-first", async () => {
    const { orderedJobs } = await import(moduleUrl);
    const rows = orderedJobs([
      { id: "old", status: "completed", startedAt: 0, finishedAt: 10 },
      { id: "live-2", status: "running", startedAt: 2 },
      { id: "new", status: "failed", startedAt: 0, finishedAt: 20 },
      { id: "live-1", status: "stopping", startedAt: 1 },
    ]);
    expect(rows.map((row: any) => row.id)).toEqual(["live-1", "live-2", "new", "old"]);
  });

  it("counts live states and clamps skewed durations", async () => {
    const { jobCounts, jobDuration } = await import(moduleUrl);
    expect(jobCounts([{ status: "running", startedAt: 0 }, { status: "completed", startedAt: 0 }])).toMatchObject({ live: 1, total: 2 });
    expect(jobDuration({ status: "failed", startedAt: 20, finishedAt: 10 }, 30)).toBe(0);
  });
});
