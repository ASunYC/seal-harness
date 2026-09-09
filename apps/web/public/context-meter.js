export function contextOccupancy(value) {
  const usedTokens = value?.projectedTokens ?? value?.pressureTokens;
  if (!Number.isFinite(usedTokens) || usedTokens < 0 || !Number.isFinite(value?.contextWindow) || value.contextWindow <= 0) return null;
  return { usedTokens, contextWindow: value.contextWindow, percent: Math.min(100, Math.round(usedTokens / value.contextWindow * 100)) };
}
