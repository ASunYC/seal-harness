export function deriveSessionAncestry(sessions, sessionId) {
  if (!sessionId) return [];
  const byId = new Map((sessions ?? []).map((session) => [session.id, session]));
  const chain = []; const seen = new Set(); let cursor = sessionId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor); const session = byId.get(cursor);
    if (!session) { if (chain.length === 0) chain.unshift({ id: cursor, displayTitle: cursor, subagent: false }); break; }
    const subagent = session.origin === "subagent";
    chain.unshift({ id: session.id, displayTitle: session.preview || session.id, subagent });
    if (!subagent) break;
    cursor = session.parentSessionId;
  }
  return chain;
}
