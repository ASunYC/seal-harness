const STATUSES = new Set(["completed", "in_progress", "pending"]);

export function todoPanelModel(value) {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item) => item && typeof item.content === "string" && item.content && STATUSES.has(item.status)).map((item) => ({ content: item.content, status: item.status }));
  if (items.length === 0) return null;
  return { items, completed: items.filter((item) => item.status === "completed").length, active: items.filter((item) => item.status === "in_progress").length, pending: items.filter((item) => item.status === "pending").length };
}
