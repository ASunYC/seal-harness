export const COMPOSER_TEXT_MAX_HEIGHT = 336;
export const COMPOSER_TEXT_MIN_HEIGHT = 62;

export function composerTextGeometry(scrollHeight, minimum = COMPOSER_TEXT_MIN_HEIGHT, maximum = COMPOSER_TEXT_MAX_HEIGHT) {
  const measured = Number.isFinite(scrollHeight) ? scrollHeight : minimum;
  const height = Math.min(maximum, Math.max(minimum, measured));
  return { height, overflowY: measured > maximum ? "auto" : "hidden" };
}

export function observeComposerSeat(seat, scroller, ResizeObserverImpl = globalThis.ResizeObserver, onResize = () => {}) {
  const publish = () => {
    scroller.style.setProperty("--dsh-composer-height", `${seat.offsetHeight}px`);
    scroller.style.setProperty("--dsh-conversation-viewport-height", `${scroller.clientHeight}px`);
    onResize();
  };
  publish();
  if (typeof ResizeObserverImpl !== "function") return () => {};
  const observer = new ResizeObserverImpl(publish);
  observer.observe(seat);
  observer.observe(scroller);
  return () => observer.disconnect();
}
