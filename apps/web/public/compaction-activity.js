// Consume durable compatible lifecycle markers, not inferred model activity.
export function createCompactionActivity() {
  let sessionId, sequence = -1;
  const active = new Set();
  return {
    reset(id) { sessionId = id; sequence = -1; active.clear(); },
    consume(payload, selected) {
      if (!selected || payload?.sessionId !== selected) return undefined;
      if (sessionId !== selected) this.reset(selected);
      let changed = false, failed = false;
      for (const stored of payload.events ?? []) {
        if (!Number.isSafeInteger(stored.sequence) || stored.sequence <= sequence) continue;
        sequence = stored.sequence;
        const event = stored.event;
        if (event?.type !== 'dsh.imported') continue;
        const { type, data } = event.payload ?? {};
        const id = data?.compactionId;
        if (type === 'compaction/start' && typeof id === 'string') { active.add(id); changed = true; }
        else if (type === 'compaction/end' && active.delete(id)) { changed = true; failed = data?.error != null; }
        else if ((type === 'turn/end' || type === 'turn/error') && active.size) { active.clear(); changed = true; failed = type === 'turn/error'; }
      }
      return changed ? active.size > 0 ? true : failed ? 'failed' : false : undefined;
    },
  };
}
