const USER_KINDS = new Set(["user", "user-rpc"]);

export function contextMessageModel(source) {
  if (!source || typeof source !== "object" || USER_KINDS.has(source.kind)) return null;
  const form = typeof source.form === "string" ? source.form
    : source.kind === "agent-message" ? "relay"
      : source.kind === "job-completion" || source.kind === "goal" ? "notice" : "opaque";
  let summary = typeof source.summary === "string" && source.summary.trim() ? source.summary.trim() : null;
  let provenance = typeof source.plugin === "string" ? source.plugin : typeof source.kind === "string" ? source.kind : "context";
  if (form === "relay" && typeof source.senderSessionId === "string") { provenance = `From ${source.senderSessionId}`; summary ??= provenance; }
  if (source.kind === "job-completion" && typeof source.jobId === "string") summary ??= `Job ${source.jobId} completed`;
  return { form, provenance, summary, structured: contextStructuredBody(form, source) };
}

function records(value) { return Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item)) ? value : null; }

export function contextStructuredBody(form, source) {
  if (!source || typeof source !== "object") return null;
  if (form === "instructions") {
    const list = records(source.changes); if (!list) return null; const seen = new Set(); const changes = [];
    for (const item of list) { if (typeof item.path !== "string" || !item.path || !["set", "replace", "remove"].includes(item.action)) return null; if (!seen.has(item.path)) { seen.add(item.path); changes.push({ path: item.path, action: item.action, ...(typeof item.digest === "string" ? { digest: item.digest } : {}) }); } }
    return changes.length ? { kind: "instructions", baseline: source.baseline === true, changes } : null;
  }
  if (form === "catalog") {
    const list = records(source.entries); if (!list) return null; const entries = [];
    for (const item of list) { if (typeof item.name !== "string" || !item.name || typeof item.description !== "string") return null; entries.push({ name: item.name, description: item.description }); }
    return { kind: "catalog", update: source.update === true, entries: entries.slice(0, 200), omitted: Math.max(0, entries.length - 200) };
  }
  if (form === "snapshot") {
    const list = records(source.sections); if (!list) return null; const sections = [];
    for (const item of list) { if (typeof item.name !== "string" || !item.name || typeof item.text !== "string") return null; sections.push({ name: item.name, text: item.text }); }
    return sections.length ? { kind: "snapshot", sections } : null;
  }
  if (form === "recall") {
    const list = records(source.references); if (!list) return null; const references = [];
    for (const item of list) { if (typeof item.label !== "string" || !item.label || typeof item.retainedMessages !== "number" || typeof item.omittedMessages !== "number" || typeof item.truncated !== "boolean") return null; references.push({ label: item.label, retained: item.retainedMessages, omitted: item.omittedMessages, truncated: item.truncated }); }
    return references.length ? { kind: "recall", references } : null;
  }
  return null;
}
