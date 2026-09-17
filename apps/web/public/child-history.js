/** One read-only history cursor; disposal invalidates all in-flight responses. */
export function createChildHistory({ fetchPage, onPage, onError, onBusy = () => {}, canPoll = () => true }) {
  let disposed = false, busy = false, history = false, pending = false;
  let before = null, hasMore = false, messages = [], fingerprint = "";
  async function load(kind = "latest") {
    if (disposed || (kind === "poll" && (history || !canPoll())) || (kind === "older" && !hasMore)) return;
    if (busy) { if (kind === "poll") pending = true; return; }
    busy = true; onBusy(true);
    try {
      const page = await fetchPage(kind === "older" ? before : null);
      // Reading state may change while the request is in flight. Do not apply
      // a late background snapshot over a selection or an older scroll anchor.
      if (disposed || (kind === "poll" && !canPoll())) return;
      // An older-page view is frozen: do not leave a stale preview labelled live.
      const next = kind === "older" ? [...page.messages, ...messages.filter(message => !message.live)] : page.messages;
      const nextFingerprint = JSON.stringify(next);
      messages = next; before = page.window?.nextBefore ?? null;
      hasMore = page.window?.hasMore === true && before !== null;
      history = kind === "older";
      if (kind !== "poll" || nextFingerprint !== fingerprint) onPage({ messages, hasMore, kind });
      fingerprint = nextFingerprint;
    } catch (error) { if (!disposed) onError(error); }
    finally {
      busy = false;
      if (!disposed) onBusy(false);
      if (pending) { pending = false; if (!disposed && !history) void load("poll"); }
    }
  }
  return { load, dispose() { disposed = true; } };
}

/** Coalesce persisted-message notifications; an occasional poll heals missed events. */
export function watchChildHistory({ sessionId, target, refresh, canRefresh, timers = globalThis }) {
  let timeout;
  let closed = false;
  const request = () => {
    if (closed || timeout !== undefined || !canRefresh()) return;
    timeout = timers.setTimeout(() => { timeout = undefined; if (!closed && canRefresh()) void refresh(); }, 150);
  };
  const changed = event => { if (event.detail?.sessionId === sessionId) request(); };
  target.addEventListener("seal-harness:session-appended", changed);
  target.addEventListener("seal-harness:events-connected", request);
  const interval = timers.setInterval(request, 10000);
  return () => {
    closed = true; target.removeEventListener("seal-harness:session-appended", changed);
    target.removeEventListener("seal-harness:events-connected", request);
    timers.clearInterval(interval); if (timeout !== undefined) timers.clearTimeout(timeout);
  };
}
