import { openImageLightbox } from "./message-images.js?v=0.3.4-2";

export function attachmentWheelDistance({ deltaX, deltaY, deltaMode }, clientWidth) {
  if (deltaY === 0) return null;
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? clientWidth : 1;
  return deltaX !== 0 ? deltaX * scale : Math.sign(deltaY) * Math.min(Math.abs(deltaY) * scale, 60);
}

export function attachmentPageDistance(clientWidth, direction) { return direction * Math.max(clientWidth - 64, 200); }

export function createAttachmentRail(items, { onRemove, locked = false, revealEnd = false, labels = {} } = {}) {
  const root = document.createElement("div"); root.className = "attachment-rail-root"; root.setAttribute("role", "group"); root.setAttribute("aria-label", labels.group || "Pending images");
  const rail = document.createElement("div"); rail.className = "attachment-rail";
  const left = document.createElement("button"); left.type = "button"; left.className = "attachment-rail-arrow left"; left.textContent = "‹"; left.setAttribute("aria-label", labels.scrollLeft || labels.left || "Scroll images left"); left.hidden = true;
  const right = document.createElement("button"); right.type = "button"; right.className = "attachment-rail-arrow right"; right.textContent = "›"; right.setAttribute("aria-label", labels.scrollRight || labels.right || "Scroll images right"); right.hidden = true;
  const updateEdges = () => { left.hidden = rail.scrollLeft <= 1; right.hidden = rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 1; };
  const page = (direction) => rail.scrollBy({ left: attachmentPageDistance(rail.clientWidth, direction), behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  left.addEventListener("click", () => page(-1)); right.addEventListener("click", () => page(1)); rail.addEventListener("scroll", updateEdges, { passive: true });
  rail.addEventListener("wheel", (event) => { const distance = attachmentWheelDistance(event, rail.clientWidth); if (distance === null) return; event.preventDefault(); rail.scrollBy({ left: distance, behavior: "auto" }); }, { passive: false });
  for (const item of items) {
    const frame = document.createElement("span"); frame.className = "attachment-rail-item";
    const name = item.name || "image"; const openLabel = typeof labels.openNamed === "function" ? labels.openNamed(name) : `${labels.open || "Open original image"}: ${name}`;
    const open = document.createElement("button"); open.type = "button"; open.className = "attachment-rail-open"; open.title = labels.open || "Open original image"; open.setAttribute("aria-label", openLabel);
    const image = document.createElement("img"); image.src = item.src; image.alt = item.name || labels.group || "Pending image"; open.append(image); open.addEventListener("click", () => openImageLightbox({ src: item.src, alt: image.alt, labels: labels.lightbox }));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "attachment-rail-remove"; remove.textContent = "×"; remove.setAttribute("aria-label", typeof labels.removeNamed === "function" ? labels.removeNamed(name) : `${labels.remove || "Remove"} ${name}`); remove.addEventListener("click", () => onRemove?.(item));
    open.disabled = locked; remove.disabled = locked;
    frame.append(open, remove); rail.append(frame);
  }
  root.append(left, rail, right);
  queueMicrotask(() => { if (revealEnd) rail.scrollLeft = rail.scrollWidth - rail.clientWidth; updateEdges(); });
  let observer; if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(updateEdges); observer.observe(rail); }
  root.dispose = () => observer?.disconnect();
  return root;
}
