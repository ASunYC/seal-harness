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

export interface AttachmentService {
  put(request: PutAttachmentRequest): Promise<AttachmentBlock>;
  get(reference: AttachmentBlock): Promise<ResolvedAttachment | undefined>;
}
