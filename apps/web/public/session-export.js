export function sessionLogExportUrl(sessionId) {
  const query = new URLSearchParams({ sessionId: String(sessionId), includeDescendants: "true" });
  return `/api/session.export?${query.toString()}`;
}

export function sessionLogZipFilename(sessionId) {
  return `dsh-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_")}.zip`;
}
