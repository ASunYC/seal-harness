const VISIBLE_PHASES = new Set(["active", "paused", "blocked"]);

export function goalBarModel(goal) {
  if (!goal || !VISIBLE_PHASES.has(goal.phase) || typeof goal.objective !== "string" || !goal.objective || typeof goal.id !== "string" || !Number.isSafeInteger(goal.revision)) return null;
  return { id: goal.id, revision: goal.revision, objective: goal.objective, phase: goal.phase, canPause: goal.phase === "active", canResume: goal.phase === "paused" };
}
