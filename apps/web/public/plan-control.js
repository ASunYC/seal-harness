export function planModeTarget(plan) {
  if (plan === null || plan === undefined || typeof plan.active !== "boolean") return false;
  return plan.pending === undefined ? plan.active : plan.pending ? !plan.active : plan.active;
}

export function planComposerPlaceholder(plan, defaultPlaceholder, planPlaceholder) {
  return planModeTarget(plan) ? planPlaceholder : defaultPlaceholder;
}
