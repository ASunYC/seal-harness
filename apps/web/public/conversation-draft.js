const PREFIX = "dsh.conversation";
const NEW_SESSION = "__new__";

export function conversationDraftKey(sessionId) {
  return `${PREFIX}.${sessionId || NEW_SESSION}`;
}

export function readConversationDraft(storage, sessionId) {
  try {
    const value = JSON.parse(storage.getItem(conversationDraftKey(sessionId)) ?? "null");
    return value && typeof value === "object" && typeof value.draft === "string" ? value.draft : "";
  } catch { return ""; }
}

export function writeConversationDraft(storage, sessionId, draft) {
  const key = conversationDraftKey(sessionId);
  let previous = {};
  try { const parsed = JSON.parse(storage.getItem(key) ?? "null"); if (parsed && typeof parsed === "object") previous = parsed; } catch {}
  storage.setItem(key, JSON.stringify({ ...previous, draft: String(draft) }));
}
