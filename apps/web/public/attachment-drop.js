export function isFileTransfer(dataTransfer) {
  return dataTransfer != null && Array.from(dataTransfer.types || []).includes("Files");
}

export function installAttachmentDrop({ canAccept, onFiles, labels = {} }) {
  let depth = 0; let overlay = null;
  const removeOverlay = () => { overlay?.remove(); overlay = null; };
  const reset = () => { depth = 0; removeOverlay(); };
  const render = () => {
    removeOverlay(); const accepting = canAccept(); const copy = typeof labels === "function" ? labels() : labels;
    overlay = document.createElement("div"); overlay.className = "attachment-drop-overlay"; overlay.setAttribute("role", "status"); overlay.dataset.disabled = String(!accepting);
    const illustration = document.createElement("div"); illustration.className = "attachment-drop-illustration"; illustration.setAttribute("aria-hidden", "true"); illustration.textContent = accepting ? "▧  ▨" : "⊘";
    const title = document.createElement("strong"); title.textContent = accepting ? (copy.title || "Drop images to attach") : (copy.blocked || "Image upload unavailable");
    overlay.append(illustration, title);
    if (accepting && copy.description) { const desc = document.createElement("span"); desc.textContent = copy.description; overlay.append(desc); }
    document.body.append(overlay);
  };
  const onDragEnter = (event) => { if (!isFileTransfer(event.dataTransfer)) return; event.preventDefault(); depth += 1; if (depth === 1) render(); };
  const onDragOver = (event) => { if (!isFileTransfer(event.dataTransfer)) return; event.preventDefault(); event.dataTransfer.dropEffect = canAccept() ? "copy" : "none"; };
  const onDragLeave = (event) => {
    if (!isFileTransfer(event.dataTransfer)) return; depth = Math.max(0, depth - 1); if (depth === 0) removeOverlay();
    const outside = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
    if ((event.target === document.documentElement || event.target === document.body) && outside) reset();
  };
  const onDrop = (event) => { if (!isFileTransfer(event.dataTransfer)) return; event.preventDefault(); const files = Array.from(event.dataTransfer.files || []); const accepting = canAccept(); reset(); if (accepting) onFiles(files); };
  document.addEventListener("dragenter", onDragEnter); document.addEventListener("dragover", onDragOver); document.addEventListener("dragleave", onDragLeave); document.addEventListener("drop", onDrop); window.addEventListener("dragend", reset);
  return () => { reset(); document.removeEventListener("dragenter", onDragEnter); document.removeEventListener("dragover", onDragOver); document.removeEventListener("dragleave", onDragLeave); document.removeEventListener("drop", onDrop); window.removeEventListener("dragend", reset); };
}
