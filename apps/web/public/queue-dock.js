export function queueItemText(item) {
  return (item?.message?.content ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("\n");
}

export function queueEditableText(item) {
  const content = item?.message?.content ?? [];
  return content.every((block) => block?.type === "text") ? content.map((block) => block.text).join("") : null;
}

export function queueItemPreview(item, maxCharacters = 200) {
  const flat = (item?.message?.content ?? [])
    .filter((block) => block?.type !== "image")
    .map((block) => block?.type === "text" ? block.text : `[${String(block?.type ?? "unknown")}]`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(flat);
  return characters.length > maxCharacters ? `${characters.slice(0, maxCharacters).join("")}…` : flat;
}

export function queueImageRefs(item) {
  return (item?.message?.content ?? []).flatMap((block) => {
    if ((block?.type === "attachment" || block?.type === "seal/attachment") && typeof block.id === "string" && /^image\//i.test(block.mimeType ?? "")) {
      return [{ id: block.id, name: block.name, mimeType: block.mimeType }];
    }
    const attachment = block?.type === "image" ? block.attachment : undefined;
    if (attachment && typeof attachment.attachmentId === "string") {
      return [{ id: attachment.attachmentId, name: attachment.name, mimeType: attachment.mediaType ?? attachment.mimeType }];
    }
    return [];
  });
}

export function queueImageUrl(image, sessionId, pending = false) {
  const query = new URLSearchParams();
  if (image?.name) query.set("name", image.name);
  if (image?.mimeType) query.set("mimeType", image.mimeType);
  const prefix = pending
    ? `/api/attachments/${encodeURIComponent(image.id)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/attachment-content/${encodeURIComponent(image.id)}`;
  return `${prefix}${query.size ? `?${query}` : ""}`;
}

export function queueSnapshotKey(items) {
  return JSON.stringify((items ?? []).map((item) => [item.id, item.placement, queueItemText(item)]));
}

export function queueDockItems(items) {
  return (items ?? []).filter((item) => item?.placement === "queued" || item?.placement === "steering");
}

export function pendingQueueItems(items, pending, sessionId) {
  const admitted = new Set((items ?? []).flatMap((item) => typeof item?.rpcId === "string" ? [item.rpcId] : []));
  return (pending ?? []).filter((item) => (item?.placement === "queued" || item?.placement === "steering") && (sessionId === undefined || item.sessionId === sessionId) && !admitted.has(item.requestId));
}

export function queueMutable(sessionId, sessions) {
  return (sessions ?? []).find((session) => session?.id === sessionId)?.origin !== "subagent";
}

export function canSteerQueueItem(item, running) {
  return Boolean(running && item?.placement === "queued");
}

export function shouldSteerQueueOnAcceleratedEnter({ draft, attachmentCount, running, items, accelerated }) {
  return Boolean(
    accelerated
    && running
    && String(draft ?? "").trim() === ""
    && Number(attachmentCount) === 0
    && (items ?? []).some((item) => item?.placement === "queued"),
  );
}

export function canAccelerateQueuedMessages({ draft, attachmentCount, running, items }) {
  return shouldSteerQueueOnAcceleratedEnter({ draft, attachmentCount, running, items, accelerated: true });
}
