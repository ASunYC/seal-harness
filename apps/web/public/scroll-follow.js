export const TRANSCRIPT_BOTTOM_THRESHOLD = 24;
export const TRANSCRIPT_SCROLL_SAMPLE_INTERVAL_MS = 500;

export function isTranscriptNearBottom(scroller, threshold = TRANSCRIPT_BOTTOM_THRESHOLD) {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= threshold;
}

export function transcriptAnchorKey(message) {
  for (const field of ["messageId", "callId", "commandId", "retryId", "workflowId", "id"]) {
    if (typeof message?.[field] === "string" && message[field]) return `${message.role || "node"}:${message[field]}`;
  }
  if (typeof message?.turnId === "string" && message.turnId) return `${message.role || "node"}:turn:${message.turnId}`;
  return null;
}

export function captureTranscriptPosition(scroller) {
  const viewport = scroller.getBoundingClientRect();
  const row = [...scroller.querySelectorAll("[data-chat-anchor-key]")]
    .find((candidate) => candidate.getBoundingClientRect().bottom > viewport.top) ?? null;
  return { scrollTop: scroller.scrollTop, anchorKey: row?.dataset.chatAnchorKey ?? null, anchorTop: row === null ? null : row.getBoundingClientRect().top - viewport.top };
}

export function restoreTranscriptPosition(scroller, position) {
  scroller.scrollTop = position.scrollTop;
  if (position.anchorKey === null || position.anchorTop === null) return;
  const row = [...scroller.querySelectorAll("[data-chat-anchor-key]")].find((candidate) => candidate.dataset.chatAnchorKey === position.anchorKey);
  if (!row) return;
  const viewport = scroller.getBoundingClientRect();
  scroller.scrollTop += row.getBoundingClientRect().top - viewport.top - position.anchorTop;
}

export function installTranscriptScrollSampling(scroller, sample, interval = TRANSCRIPT_SCROLL_SAMPLE_INTERVAL_MS, timers = globalThis) {
  let pending = false;
  let timer;
  const flush = () => {
    if (!pending) return;
    pending = false;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    sample();
  };
  const schedule = () => {
    pending = true;
    timer ??= timers.setTimeout(flush, interval);
  };
  scroller.addEventListener("scroll", schedule, { passive: true });
  scroller.addEventListener("scrollend", flush, { passive: true });
  return () => {
    scroller.removeEventListener("scroll", schedule);
    scroller.removeEventListener("scrollend", flush);
    if (timer !== undefined) timers.clearTimeout(timer);
    pending = false;
  };
}
