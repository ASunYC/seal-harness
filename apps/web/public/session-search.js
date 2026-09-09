export const SESSION_SEARCH_DEBOUNCE_MS = 250;
export const SESSION_SEARCH_MAX_CODE_UNITS = 500;

export function sanitizeSessionSearchQuery(value) {
  const clean = String(value ?? "").replaceAll("\0", "");
  if (clean.length <= SESSION_SEARCH_MAX_CODE_UNITS) return clean;
  let end = SESSION_SEARCH_MAX_CODE_UNITS;
  const last = clean.charCodeAt(end - 1); const next = clean.charCodeAt(end);
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1;
  return clean.slice(0, end);
}

export function localSessionSearchResults(sessions, workspaces, query) {
  const needle = sanitizeSessionSearchQuery(query).trim().toLocaleLowerCase();
  if (!needle) return [];
  const workspaceBySession = new Map();
  for (const workspace of workspaces ?? []) for (const id of workspace.sessionIds ?? []) workspaceBySession.set(id, workspace);
  const results = [];
  for (const session of sessions ?? []) {
    if (session.blank === true) continue;
    const workspace = workspaceBySession.get(session.id);
    const fields = [session.preview, session.id, session.cwd, workspace?.title, workspace?.path].filter((value) => typeof value === "string" && value !== "");
    if (!fields.some((value) => value.toLocaleLowerCase().includes(needle))) continue;
    results.push({ sessionId: session.id, workspace: workspace?.title ?? null, snippet: "", local: true });
  }
  return results;
}

export function mergeSessionSearchResults(local, remote) {
  const merged = []; const byId = new Map();
  for (const item of [...local, ...remote]) {
    const existing = byId.get(item.sessionId);
    if (existing === undefined) { const copy = { ...item }; byId.set(item.sessionId, copy); merged.push(copy); continue; }
    if (item.local !== true && item.snippet) existing.snippet = item.snippet;
  }
  return merged;
}

export function shouldDismissSessionSearch(expanded, query, targetInside) {
  return expanded === true && String(query ?? "").trim() === "" && targetInside !== true;
}
