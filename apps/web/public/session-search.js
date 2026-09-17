export const SESSION_SEARCH_DEBOUNCE_MS = 250;
export const SESSION_SEARCH_MAX_CODE_UNITS = 500;

// Match across inline Markdown nodes without replacing renderer-owned markup.
export function findTranscriptMatch(root, query) {
  const needle = sanitizeSessionSearchQuery(query).trim();
  if (!needle) return null;
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  for (const content of root.querySelectorAll(".content, .reasoning-content, .semantic-tool-block pre, .context-content")) {
    const walker = root.ownerDocument.createTreeWalker(content, 4);
    const nodes = []; let value = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest("button, script, style, [aria-hidden='true']")) continue;
      nodes.push({ node, start: value.length, end: value.length + node.textContent.length });
      value += node.textContent;
    }
    const match = pattern.exec(value);
    if (!match) continue;
    const start = nodes.find(part => part.end > match.index);
    const end = nodes.find(part => part.end >= match.index + match[0].length);
    if (!start || !end) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, match.index - start.start);
    range.setEnd(end.node, match.index + match[0].length - end.start);
    return { range, element: content };
  }
  return null;
}

export async function locateTranscriptMatch({ root, query, active, cursor, loadEarlier }) {
  while (active()) {
    const match = findTranscriptMatch(root, query);
    if (match) return match;
    const before = cursor();
    if (before === null) return null;
    await loadEarlier();
    if (!active() || cursor() === before) return null;
  }
  return null;
}

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
