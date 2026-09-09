import type { AttachmentBlock } from "./content.js";

export interface PutAttachmentRequest {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly name?: string;
}

export interface ResolvedAttachment {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly name?: string;
}

export interface ImageRequestPolicy {
  readonly maxPixels: number;
  readonly maxBytes: number;
}

export interface ResolvedImageRequest {
  readonly variantId: string;
  readonly attachment: AttachmentBlock;
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly depth: "uchar";
  readonly space: "srgb";
  readonly hasAlpha: boolean;
}

export interface ImageAttachmentLimits {
  readonly maxImageBytes: number;
  readonly maxImagesPerMessage: number;
  readonly maxMessageImageBytes: number;
  readonly maxImagePixels: number;
  readonly maxImageDimension: number;
  readonly mediaTypes: readonly string[];
}

export interface AttachmentService {
  readonly imageLimits?: ImageAttachmentLimits;
  put(request: PutAttachmentRequest): Promise<AttachmentBlock>;
  get(reference: AttachmentBlock): Promise<ResolvedAttachment | undefined>;
  readImageRequest?(reference: AttachmentBlock, policy: ImageRequestPolicy, signal?: AbortSignal): Promise<ResolvedImageRequest>;
}
