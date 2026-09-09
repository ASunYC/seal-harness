function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
  const unitsPerPercent = decimalPlaces === 0 ? 1 : 10; const scale = unitsPerPercent * 100; const doubledScale = scale * 2;
  const quotient = Math.floor(denominator / doubledScale); const remainder = denominator % doubledScale; let lower = 0; let upper = scale;
  while (lower < upper) { const candidate = Math.floor((lower + upper + 1) / 2); const factor = candidate * 2 - 1; const threshold = factor * quotient + Math.ceil(factor * remainder / doubledScale); if (cacheReadTokens >= threshold) lower = candidate; else upper = candidate - 1; }
  return lower;
}

export function formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 0) {
  if (promptTokens === 0) return null;
  const missed = promptTokens - cacheReadTokens; if (missed === 0) return "100";
  const units = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces); const full = decimalPlaces === 0 ? 100 : 1000;
  if (units < full) { if (decimalPlaces === 0) return String(units); const whole = Math.floor(units / 10); const tenths = units % 10; return tenths === 0 ? String(whole) : `${whole}.${tenths}`; }
  let places = 1; let scaledGap = missed * 200; const tens = Math.floor(promptTokens / 10);
  while (scaledGap <= tens) { scaledGap *= 10; places += 1; }
  const ones = promptTokens % 10; let roundedLoss = 5;
  for (let loss = 1; loss < 5; loss += 1) { const factor = loss * 2 + 1; if (scaledGap <= factor * tens + Math.floor(factor * ones / 10)) { roundedLoss = loss; break; } }
  return `99.${"9".repeat(places - 1)}${10 - roundedLoss}`;
}

export function promptTokensForUsage(usage) {
  if (Number.isSafeInteger(usage?.totalTokens) && Number.isSafeInteger(usage?.outputTokens) && usage.totalTokens >= usage.outputTokens) return usage.totalTokens - usage.outputTokens;
  return (usage?.inputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0);
}

export function formatRunDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000)); const minutes = Math.floor(total / 60); const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

export function formatLatencySeconds(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return String(seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds));
}

export function formatTokensPerSecond(value) {
  const clamped = Math.max(0, value);
  return String(clamped >= 10 ? Math.round(clamped) : Math.round(clamped * 10) / 10);
}

export function formatCompactTokens(value, thousand = "{value}K", million = "{value}M") {
  if (!Number.isSafeInteger(value) || value < 0) return "unknown";
  const scaled = candidate => String(candidate >= 100 ? Math.round(candidate) : Math.round(candidate * 10) / 10);
  if (value < 1_000) return String(value);
  const template = value < 1_000_000 ? thousand : million;
  const divisor = value < 1_000_000 ? 1_000 : 1_000_000;
  return template.replace("{value}", scaled(value / divisor));
}

export function formatExactTokenCount(value, separator = ",") {
  if (!Number.isSafeInteger(value) || value < 0) return "unknown";
  const digits = String(value); const first = digits.length % 3 || 3; const groups = [digits.slice(0, first)];
  for (let index = first; index < digits.length; index += 3) groups.push(digits.slice(index, index + 3));
  return groups.join(separator);
}

export function formatCompactDuration(ms, secondsTemplate = "{seconds}s", minutesTemplate = "{minutes}m{seconds}s") {
  const seconds = Math.max(0, ms) / 1_000;
  if (seconds < 60) return secondsTemplate.replace("{seconds}", String(Math.round(seconds * 10) / 10));
  const whole = Math.round(seconds);
  return minutesTemplate.replace("{minutes}", String(Math.floor(whole / 60))).replace("{seconds}", String(whole % 60));
}
