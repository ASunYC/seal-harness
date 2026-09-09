export function treeNavigationIndex(length, current, key) {
  if (length <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return Math.min(length - 1, Math.max(0, current + 1));
  if (key === "ArrowUp") return Math.max(0, current < 0 ? 0 : current - 1);
  return current;
}

export function shouldShowSessionEmptyState(renderedChildren, searchQuery) {
  return renderedChildren === 0 && String(searchQuery ?? "").trim() === "";
}
