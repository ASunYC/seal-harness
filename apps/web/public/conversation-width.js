export const CONTENT_MIN = 640;
export const CONTENT_EDGE_BUDGET = 176;

export function resolveContentWidth(columnWidth, preference) {
  const maximum = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET);
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), maximum);
  return Math.max(680, Math.min(columnWidth * 0.64, 920));
}
