export function isLiveJob(job) { return job?.status === "running" || job?.status === "stopping"; }

export function orderedJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return [...jobs].sort((left, right) => {
    const leftLive = isLiveJob(left); const rightLive = isLiveJob(right);
    if (leftLive !== rightLive) return leftLive ? -1 : 1;
    if (leftLive) return left.startedAt - right.startedAt;
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt);
    return finished || left.startedAt - right.startedAt;
  });
}

export function jobDuration(job, now = Date.now()) {
  const end = isLiveJob(job) ? now : (job.finishedAt ?? job.startedAt);
  return Math.max(0, end - job.startedAt);
}

export function jobCounts(jobs) {
  const rows = orderedJobs(jobs); return { rows, live: rows.filter(isLiveJob).length, total: rows.length };
}
