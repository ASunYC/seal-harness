export function normalizeTurnOutline(value) {
  if (!Array.isArray(value)) return [];
  const turns = new Map();
  for (const item of value) {
    if (!item || !Number.isSafeInteger(item.turn) || item.turn < 0 || typeof item.turnId !== "string" || !item.turnId) continue;
    turns.set(item.turn, { turn: item.turn, turnId: item.turnId, prompt: typeof item.prompt === "string" ? item.prompt : "", response: typeof item.response === "string" ? item.response : "" });
  }
  return [...turns.values()].sort((left, right) => left.turn - right.turn);
}

export function activeTurnFromGeometry(rows, viewportTop) {
  if (!rows.length) return null;
  let active = rows[0];
  for (const row of rows) {
    if (row.top > viewportTop + 32) break;
    active = row;
  }
  return active.turn;
}
