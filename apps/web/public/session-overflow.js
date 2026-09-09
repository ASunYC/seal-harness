export const COLLAPSED_SESSION_LIMIT = 5;

export function collapsedSessionRows(sessions, limit = COLLAPSED_SESSION_LIMIT) {
  let ordinaryCount = 0;
  const rows = (sessions ?? []).filter((session) => {
    if (session.blank) return true;
    if (ordinaryCount >= limit) return false;
    ordinaryCount += 1; return true;
  });
  return { rows, hiddenCount: (sessions ?? []).length - rows.length };
}
