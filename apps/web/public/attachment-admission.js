export class AttachmentAdmission {
  constructor(attachments, commit, restore) { this.attachments = [...attachments]; this.commitFn = commit; this.restoreFn = restore; this.state = "pending"; }
  accepted() { if (this.state !== "pending") return false; this.state = "accepted"; this.commitFn(this.attachments); return true; }
  failed() { if (this.state !== "pending") return false; this.state = "failed"; this.restoreFn(this.attachments); return true; }
}

export function imageAdmissionIssue(existing, incoming, limits) {
  const images = incoming.filter((file) => limits.mediaTypes.includes(file.type));
  if (images.length !== incoming.length) return { kind: "unsupported" };
  if (existing.length + images.length > limits.maxImagesPerMessage) return { kind: "too-many", count: limits.maxImagesPerMessage };
  if (images.some((file) => file.size > limits.maxImageBytes)) return { kind: "file-too-large", bytes: limits.maxImageBytes };
  const total = existing.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0) + images.reduce((sum, file) => sum + file.size, 0);
  if (total > limits.maxMessageImageBytes) return { kind: "total-too-large", bytes: limits.maxMessageImageBytes };
  return null;
}

export function imageUploadError(error) {
  const reason = error?.details?.reason;
  if (reason === "INVALID_IMAGE" || reason === "IMAGE_TYPE_MISMATCH" || reason === "UNSUPPORTED_IMAGE_TYPE") return { key: "image.unsupportedType" };
  if (reason === "IMAGE_TOO_MANY_PIXELS") return { key: "image.tooManyPixels" };
  if (reason === "IMAGE_DIMENSION_TOO_LARGE") return { key: "image.dimensionTooLarge", values: { size: "8192" } };
  return null;
}

export function clipboardFiles(clipboardData) {
  return Array.from(clipboardData?.items ?? []).filter((item) => item?.kind === "file").map((item) => item.getAsFile()).filter((file) => file !== null);
}

export function canAcceptImageInput({ admissionLocked, interactionActive, imageCount, maxImages }) {
  return !admissionLocked && !interactionActive && imageCount < maxImages;
}
