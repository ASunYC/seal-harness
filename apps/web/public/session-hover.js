export const SESSION_HOVER_DELAY_MS = 500;
export const SESSION_HOVER_GRACE_MS = 160;

export function sessionDisplayTitle(session, newSessionLabel, defaultLabel) {
  return session?.blank === true ? newSessionLabel : session?.preview || defaultLabel;
}

export function sessionRelativeTime(at, now = Date.now()) {
  const minute = 60_000; const hour = 60 * minute; const day = 24 * hour; const diff = Math.max(0, now - at);
  if (diff < minute) return { unit: "now", n: 0 };
  if (diff < hour) return { unit: "minutes", n: Math.floor(diff / minute) };
  if (diff < day) return { unit: "hours", n: Math.floor(diff / hour) };
  if (diff < 30 * day) return { unit: "days", n: Math.floor(diff / day) };
  if (diff < 365 * day) return { unit: "months", n: Math.floor(diff / (30 * day)) };
  return { unit: "years", n: Math.floor(diff / (365 * day)) };
}

export function abbreviateWorkspaceHomePath(path, home) {
  if (!home || /^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(home) || path.includes("\\") || home.includes("\\")) return path;
  const root = home.replace(/\/+$/, "");
  if (!root || root === "/") return path;
  if (path.replace(/\/+$/, "") === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}
