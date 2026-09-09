export function singleImageFit({ width, height }) {
  if (!(width > 0) || !(height > 0)) return { width: 240, height: 240, objectPosition: "center" };
  const natural = width / height;
  const ratio = Math.min(4, Math.max(0.25, natural));
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
  const scale = Math.min(1, width / box.width, height / box.height);
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? "center top" : natural > 4 ? "left center" : "center",
  };
}

export function openImageLightbox({ src, alt, labels = {} }) {
  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement("div"); backdrop.className = "image-lightbox"; backdrop.setAttribute("role", "dialog"); backdrop.setAttribute("aria-modal", "true"); backdrop.setAttribute("aria-label", labels.dialog || "Image preview");
  const mask = document.createElement("div"); mask.className = "image-lightbox-mask"; mask.setAttribute("aria-hidden", "true");
  const image = document.createElement("img"); image.className = "image-lightbox-original"; image.src = src; image.alt = alt;
  const close = document.createElement("button"); close.type = "button"; close.className = "image-lightbox-close"; close.setAttribute("aria-label", labels.close || "Close preview"); close.textContent = "×";
  let closed = false;
  const dismiss = () => { if (closed) return; closed = true; window.removeEventListener("keydown", onKeyDown); backdrop.remove(); restore?.focus(); };
  const onKeyDown = (event) => { if (event.key === "Escape") dismiss(); };
  mask.addEventListener("mousedown", dismiss); close.addEventListener("click", dismiss); window.addEventListener("keydown", onKeyDown);
  backdrop.append(mask, image, close); document.body.append(backdrop); close.focus();
  return dismiss;
}

export function createMessageImageGallery(images, labels = {}) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const gallery = document.createElement("div"); gallery.className = "message-image-gallery"; gallery.dataset.variant = images.length === 1 ? "single" : "tile";
  for (const spec of images) {
    const button = document.createElement("button"); button.type = "button"; button.className = "message-image-frame"; button.title = labels.open || "Open original image";
    const alt = spec.alt || labels.image || "Attached image"; button.setAttribute("aria-label", (labels.openNamed || ((name) => `Open ${name}`))(alt));
    const loading = document.createElement("span"); loading.className = "message-image-loading"; loading.textContent = labels.loading || "Loading image…";
    const image = document.createElement("img"); image.className = "message-image"; image.alt = alt; image.loading = "lazy"; image.hidden = true;
    let failed = false;
    if (images.length === 1) {
      const applyFit = () => { const fit = singleImageFit({ width: spec.width || image.naturalWidth, height: spec.height || image.naturalHeight }); button.style.width = `${fit.width}px`; button.style.height = `${fit.height}px`; image.style.objectPosition = fit.objectPosition; };
      applyFit(); image.addEventListener("load", applyFit);
    }
    const request = () => { failed = false; button.classList.remove("error"); button.title = labels.open || "Open original image"; button.replaceChildren(loading, image); image.hidden = true; image.src = ""; queueMicrotask(() => { image.src = spec.src; }); };
    image.addEventListener("load", () => { failed = false; loading.remove(); image.hidden = false; });
    image.addEventListener("error", () => { failed = true; button.classList.add("error"); button.title = labels.loadFailed || "Image failed to load; retry"; button.textContent = labels.loadFailed || "Image failed to load; retry"; });
    button.addEventListener("click", () => { if (failed) request(); else if (!image.hidden) openImageLightbox({ src: spec.src, alt, labels: labels.lightbox }); });
    button.append(loading, image); image.src = spec.src; gallery.append(button);
  }
  return gallery;
}
