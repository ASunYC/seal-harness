export class AttachmentDraftStore {
  constructor() { this.drafts = new Map(); }
  switch(currentSessionId, nextSessionId, current) {
    this.drafts.set(currentSessionId, [...current]);
    return [...(this.drafts.get(nextSessionId) || [])];
  }
  update(sessionId, current) { this.drafts.set(sessionId, [...current]); }
  adopt(currentSessionId, nextSessionId, current) {
    this.drafts.delete(currentSessionId); this.drafts.set(nextSessionId, [...current]);
  }
  removeEverywhere(consumed) {
    const ids = new Set(consumed.map((item) => item.id));
    for (const [sessionId, draft] of this.drafts) this.drafts.set(sessionId, draft.filter((item) => !ids.has(item.id)));
  }
}
