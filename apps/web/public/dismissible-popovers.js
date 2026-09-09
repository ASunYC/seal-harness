export function anchoredPopoverPosition(anchor, panel, viewport, { side = "bottom", margin = 12, gap = 4 } = {}) {
  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const left = Math.min(maxLeft, Math.max(margin, anchor.left));
  const maxTop = Math.max(margin, viewport.height - panel.height - margin);
  const naturalTop = side === "top" ? anchor.top - panel.height - gap : anchor.bottom + gap;
  const top = Math.min(maxTop, Math.max(margin, naturalTop));
  return { left, top };
}

export function installDismissiblePopovers(doc = document) {
  const observers = new Map();
  const openPopovers = () => [...doc.querySelectorAll("details[data-dismissible-popover][open], [data-dismissible-popover-root][data-popover-open]")];
  const triggerOf = (popover) => popover.matches("details") ? popover.querySelector(":scope > summary") : popover.querySelector("[data-dismissible-trigger]");
  const panelOf = (popover) => popover.querySelector(":scope > [role='dialog']");
  const position = (popover) => {
    const anchor = triggerOf(popover); const panel = panelOf(popover);
    if (!anchor || !panel) return;
    const view = doc.defaultView; const point = anchoredPopoverPosition(anchor.getBoundingClientRect(), panel.getBoundingClientRect(), { width: view?.innerWidth ?? doc.documentElement.clientWidth, height: view?.innerHeight ?? doc.documentElement.clientHeight }, { side: popover.dataset.popoverSide === "top" ? "top" : "bottom", gap: Number(popover.dataset.popoverGap) || 4, margin: Number(popover.dataset.popoverMargin) || 12 });
    panel.style.left = `${point.left}px`; panel.style.top = `${point.top}px`;
  };
  const positionOpen = () => { for (const popover of openPopovers()) position(popover); };
  const stopObserving = (popover) => { observers.get(popover)?.disconnect(); observers.delete(popover); };
  const observe = (popover) => {
    stopObserving(popover);
    const panel = panelOf(popover); const Observer = doc.defaultView?.ResizeObserver;
    if (!panel || typeof Observer !== "function") return;
    const observer = new Observer(() => position(popover)); observer.observe(panel); observers.set(popover, observer);
  };
  const close = (popover, restoreFocus = false) => {
    if (popover.dataset.dismissibleLocked === "true") return;
    const trigger = triggerOf(popover); const panel = panelOf(popover);
    if (popover.matches("details")) popover.open = false;
    else { delete popover.dataset.popoverOpen; panel?.remove(); }
    stopObserving(popover);
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger?.focus();
  };
  const onPointerDown = (event) => {
    for (const popover of openPopovers()) if (!popover.contains(event.target)) close(popover);
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    const open = openPopovers();
    if (!open.length) return;
    for (const popover of open) close(popover, popover.contains(doc.activeElement));
  };
  const onToggle = (event) => {
    const popover = event.target;
    if (!popover?.matches?.("details[data-dismissible-popover]")) return;
    popover.querySelector(":scope > summary")?.setAttribute("aria-expanded", String(popover.open));
    if (popover.open) { position(popover); observe(popover); } else stopObserving(popover);
  };
  const onOpen = (event) => {
    const popover = event.target?.closest?.("[data-dismissible-popover-root]");
    if (popover) { position(popover); observe(popover); }
  };
  const onClose = (event) => {
    const popover = event.target?.closest?.("[data-dismissible-popover-root]");
    if (popover) close(popover, event.detail?.restoreFocus === true);
  };
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("toggle", onToggle, true);
  doc.addEventListener("dismissible-popover-open", onOpen);
  doc.addEventListener("dismissible-popover-close", onClose);
  doc.defaultView?.addEventListener("resize", positionOpen);
  doc.addEventListener("scroll", positionOpen, true);
  for (const popover of openPopovers()) { position(popover); observe(popover); }
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown);
    doc.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("toggle", onToggle, true);
    doc.removeEventListener("dismissible-popover-open", onOpen);
    doc.removeEventListener("dismissible-popover-close", onClose);
    doc.defaultView?.removeEventListener("resize", positionOpen);
    doc.removeEventListener("scroll", positionOpen, true);
    for (const observer of observers.values()) observer.disconnect(); observers.clear();
  };
}
