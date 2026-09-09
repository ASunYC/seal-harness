import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/attachment-admission.js")).href;

describe("attachment submission admission", () => {
  it("commits exactly once as soon as a run is accepted", async () => {
    const { AttachmentAdmission } = await import(moduleUrl); const commit = vi.fn(); const restore = vi.fn(); const items = [{ id: "a" }]; const admission = new AttachmentAdmission(items, commit, restore);
    expect(admission.accepted()).toBe(true); expect(admission.accepted()).toBe(false); expect(admission.failed()).toBe(false); expect(commit).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledWith(items); expect(restore).not.toHaveBeenCalled();
  });

  it("restores exactly once only when admission fails before acceptance", async () => {
    const { AttachmentAdmission } = await import(moduleUrl); const commit = vi.fn(); const restore = vi.fn(); const items = [{ id: "a" }]; const admission = new AttachmentAdmission(items, commit, restore);
    expect(admission.failed()).toBe(true); expect(admission.failed()).toBe(false); expect(admission.accepted()).toBe(false); expect(restore).toHaveBeenCalledWith(items); expect(commit).not.toHaveBeenCalled();
  });

  it("rejects an image batch atomically in upstream priority order", async () => {
    const { imageAdmissionIssue } = await import(moduleUrl);
    const limits = { mediaTypes: ["image/png"], maxImagesPerMessage: 2, maxImageBytes: 20, maxMessageImageBytes: 30 };
    expect(imageAdmissionIssue([], [{ type: "text/plain", size: 1 }], limits)).toEqual({ kind: "unsupported" });
    expect(imageAdmissionIssue([{ bytes: 1 }], [{ type: "image/png", size: 1 }, { type: "image/png", size: 1 }], limits)).toEqual({ kind: "too-many", count: 2 });
    expect(imageAdmissionIssue([], [{ type: "image/png", size: 21 }], limits)).toEqual({ kind: "file-too-large", bytes: 20 });
    expect(imageAdmissionIssue([{ bytes: 15 }], [{ type: "image/png", size: 16 }], limits)).toEqual({ kind: "total-too-large", bytes: 30 });
    expect(imageAdmissionIssue([{ bytes: 10 }], [{ type: "image/png", size: 20 }], limits)).toBeNull();
  });

  it("maps authoritative decode failures to first-party image copy", async () => {
    const { imageUploadError } = await import(moduleUrl);
    expect(imageUploadError({ details: { reason: "IMAGE_TYPE_MISMATCH" } })).toEqual({ key: "image.unsupportedType" });
    expect(imageUploadError({ details: { reason: "IMAGE_TOO_MANY_PIXELS" } })).toEqual({ key: "image.tooManyPixels" });
    expect(imageUploadError({ details: { reason: "IMAGE_DIMENSION_TOO_LARGE" } })).toEqual({ key: "image.dimensionTooLarge", values: { size: "8192" } });
    expect(imageUploadError(new Error("network"))).toBeNull();
  });

  it("extracts clipboard file items in order and skips null entries", async () => {
    const { clipboardFiles } = await import(moduleUrl); const first = { name: "a.png" }; const second = { name: "b.png" };
    expect(clipboardFiles({ items: [{ kind: "string", getAsFile: () => first }, { kind: "file", getAsFile: () => first }, { kind: "file", getAsFile: () => null }, { kind: "file", getAsFile: () => second }] })).toEqual([first, second]);
    expect(clipboardFiles(null)).toEqual([]);
  });

  it("blocks image intake while admission or a Composer takeover is active", async () => {
    const { canAcceptImageInput } = await import(moduleUrl);
    expect(canAcceptImageInput({ admissionLocked: false, interactionActive: false, imageCount: 19, maxImages: 20 })).toBe(true);
    expect(canAcceptImageInput({ admissionLocked: true, interactionActive: false, imageCount: 0, maxImages: 20 })).toBe(false);
    expect(canAcceptImageInput({ admissionLocked: false, interactionActive: true, imageCount: 0, maxImages: 20 })).toBe(false);
    expect(canAcceptImageInput({ admissionLocked: false, interactionActive: false, imageCount: 20, maxImages: 20 })).toBe(false);
  });
});
