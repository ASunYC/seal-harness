// Keep plain persisted messages, not detached DOM trees. Reading older content
// grows the mounted range; returning to latest can release that range again.
export function createHistoryWindow(messages, budget = 60) {
  let rows = [...messages];
  let start = Math.max(0, rows.length - budget);
  function alignTurn() {
    const turn = rows[start]?.turnId;
    if (turn) while (start > 0 && rows[start - 1]?.turnId === turn) start--;
  }
  alignTurn();
  return {
    get visible() { return rows.slice(start); },
    get hidden() { return start; },
    get messages() { return rows; },
    get canTrim() {
      let boundary = Math.max(0, rows.length - 60);
      const turn = rows[boundary]?.turnId;
      if (turn) while (boundary > 0 && rows[boundary - 1]?.turnId === turn) boundary--;
      return start < boundary;
    },
    reveal(count = 40) {
      const previous = start; start = Math.max(0, start - count); alignTurn();
      return rows.slice(start, previous);
    },
    prepend(messages) { rows = [...messages, ...rows]; },
  };
}
