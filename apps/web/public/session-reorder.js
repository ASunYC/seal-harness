export function moveSessionIds(ids, index, offset) {
  const target = index + offset;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids]; [next[index], next[target]] = [next[target], next[index]]; return next;
}

export function sessionInsertionAnchor(ids, index, offset) {
  const moved = moveSessionIds(ids, index, offset); const id = ids[index]; const position = moved.indexOf(id);
  return position < 0 ? undefined : moved[position + 1];
}

export function dropSessionIds(ids, activeId, overId, half) {
  if (activeId === overId || !ids.includes(activeId) || !ids.includes(overId)) return [...ids];
  const next = ids.filter((id) => id !== activeId); let index = next.indexOf(overId);
  if (half === "after") index += 1;
  next.splice(index, 0, activeId); return next;
}

export function applyPreferredSessionOrder(sessions, preferredIds) {
  const rank = new Map((preferredIds ?? []).map((id, index) => [id, index]));
  return sessions.map((session, index) => ({ session, index })).sort((left, right) => (rank.get(left.session.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.session.id) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index).map((entry) => entry.session);
}

export function sortSessionsByUpdated(sessions) {
  return [...sessions].sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) || left.id.localeCompare(right.id));
}

export function promoteBlankSession(sessions, currentId, suppressed = false) {
  if (suppressed || !currentId) return [...sessions];
  const index = sessions.findIndex((session) => session.id === currentId && session.blank === true);
  if (index <= 0) return [...sessions];
  return [sessions[index], ...sessions.slice(0, index), ...sessions.slice(index + 1)];
}
