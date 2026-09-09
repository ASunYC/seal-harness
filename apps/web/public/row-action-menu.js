export const ROW_ACTION_MENU_GRACE_MS = 160;

export function rowActionMenuIndex(length, current, key) {
  if (length <= 0) return -1;
  if (key === "ArrowDown") return (current + 1 + length) % length;
  if (key === "ArrowUp") return (current - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return current;
}
