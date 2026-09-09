import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  attachmentServiceToken,
  contextServiceToken,
  text,
  type AgentMessage,
  type AttachmentBlock,
  type AttachmentService,
  type ContentBlock,
  type ContextContribution,
  type ContextRequest,
  type ContextSource,
  type SealHarnessEvents,
  type PutAttachmentRequest,
  type ResolvedAttachment,
  type ImageAttachmentLimits,
  type ImageRequestPolicy,
  type ResolvedImageRequest,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface LocalAttachmentConfig {
  readonly root: string;
  readonly maxResolvedBytes?: number;
  readonly normalizedImageMaxPixels?: number;
  readonly normalizedImageMaxDimension?: number;
  readonly normalizedImageMaxBytes?: number;
  readonly imageCompressionConcurrency?: number;
}

export class LocalAttachmentStore implements AttachmentService {
  readonly root: string;
  readonly normalizationPolicy: Readonly<{ maxPixels: number; maxDimension: number; maxBytes: number }>;
  readonly imageCompressionConcurrency: number;
  #activeImageTransforms = 0;
  readonly #imageTransformWaiters: Array<() => void> = [];
  readonly #requestInflight = new Map<string, Promise<ResolvedImageRequest>>();
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 20 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 200 * 1024 * 1024,
    maxImagePixels: 64_000_000,
    maxImageDimension: 8192,
    mediaTypes: Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  });

  constructor(root: string, normalization: Pick<LocalAttachmentConfig, "normalizedImageMaxPixels" | "normalizedImageMaxDimension" | "normalizedImageMaxBytes" | "imageCompressionConcurrency"> = {}) {
    this.root = resolve(root);
    this.normalizationPolicy = Object.freeze({
      maxPixels: normalization.normalizedImageMaxPixels ?? 2048 * 2048,
      maxDimension: normalization.normalizedImageMaxDimension ?? 8192,
      maxBytes: normalization.normalizedImageMaxBytes ?? 4 * 1024 * 1024,
    });
    for (const [name, value] of Object.entries(this.normalizationPolicy)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`attachment-local: ${name} must be a positive integer`);
    }
    const concurrency = "imageCompressionConcurrency" in normalization ? normalization.imageCompressionConcurrency ?? 2 : 2;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("attachment-local: imageCompressionConcurrency must be an integer from 1 through 8");
    this.imageCompressionConcurrency = concurrency;
  }

  async put(request: PutAttachmentRequest): Promise<AttachmentBlock> {
    const stored: NormalizedPutAttachment = request.mimeType.startsWith("image/")
      ? await this.#withImageTransform(() => normalizeImage(request, this.imageLimits, this.normalizationPolicy))
      : request;
    const hash = createHash("sha256").update(stored.data).digest("hex");
    const id = `sha256:${hash}`;
    const directory = join(this.root, hash.slice(0, 2));
    const target = join(directory, hash);
    const staging = join(this.root, "tmp");
    await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(staging, { recursive: true, mode: 0o700 });
    const temporary = join(staging, randomUUID()); let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600); await handle.writeFile(stored.data); await handle.sync(); await handle.close(); handle = undefined;
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(target); if (createHash("sha256").update(existing).digest("hex") !== hash) throw new Error(`Stored attachment failed integrity verification: ${id}`);
      }
      await unlink(temporary); await chmod(target, 0o400);
    } catch (error) {
      await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error;
    }
    const name = displayName(request.name);
    return {
      type: "attachment",
      id,
      mimeType: stored.mimeType,
      bytes: stored.data.byteLength,
      ...(stored.width === undefined ? {} : { width: stored.width, height: stored.height }),
      ...(stored.originalDimensions === undefined ? {} : { originalDimensions: stored.originalDimensions }),
      ...(name === undefined ? {} : { name }),
    };
  }

  async get(reference: AttachmentBlock): Promise<ResolvedAttachment | undefined> {
    const hash = parseId(reference.id);
    try {
      const data = await readFile(join(this.root, hash.slice(0, 2), hash));
      if (createHash("sha256").update(data).digest("hex") !== hash) throw new Error(`Stored attachment failed integrity verification: ${reference.id}`);
      if (reference.bytes !== undefined && data.byteLength !== reference.bytes) throw new Error(`Stored attachment byte length does not match its reference: ${reference.id}`);
      if (reference.mimeType?.startsWith("image/")) {
        const metadata = await sharp(data, { failOn: "error", limitInputPixels: false }).metadata();
        const mediaType = metadata.format === "png" ? "image/png" : metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : metadata.format === "gif" ? "image/gif" : undefined;
        const transposed = metadata.orientation !== undefined && metadata.orientation >= 5; const width = transposed ? metadata.height : metadata.width; const height = transposed ? metadata.width : metadata.height;
        if (mediaType !== reference.mimeType || (reference.width !== undefined && width !== reference.width) || (reference.height !== undefined && height !== reference.height)) throw new Error(`Stored attachment metadata does not match its reference: ${reference.id}`);
      }
      return {
        data,
        mimeType: reference.mimeType ?? "application/octet-stream",
        ...(reference.name === undefined ? {} : { name: reference.name }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async readImageRequest(reference: AttachmentBlock, policy: ImageRequestPolicy, signal?: AbortSignal): Promise<ResolvedImageRequest> {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(policy.maxPixels) || policy.maxPixels < 1 || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1) throw new Error("Image request limits must be positive integers");
    if (reference.width === undefined || reference.height === undefined || reference.mimeType === undefined || !reference.mimeType.startsWith("image/")) throw new Error("Image attachment reference is incomplete");
    const variantId = requestVariantId(reference, policy); let operation = this.#requestInflight.get(variantId);
    if (operation === undefined) {
      operation = this.#withImageTransform(() => this.#createImageRequest(reference, policy, variantId)); this.#requestInflight.set(variantId, operation);
      void operation.finally(() => { if (this.#requestInflight.get(variantId) === operation) this.#requestInflight.delete(variantId); }).catch(() => {});
    }
    return waitForRequest(operation, signal);
  }

  async #createImageRequest(reference: AttachmentBlock, policy: ImageRequestPolicy, variantId: string): Promise<ResolvedImageRequest> {
    const stored = await this.get(reference); if (stored === undefined) throw new Error(`Attachment not found: ${reference.id}`);
    const source = await sharp(stored.data, { failOn: "error", limitInputPixels: false }).metadata(); const sourceAlpha = Boolean(source.hasAlpha);
    const maximum = requestDimensions(reference.width!, reference.height!, policy.maxPixels); const cache = join(this.root, "request-images", variantId.slice("sha256:".length, "sha256:".length + 2), variantId.slice("sha256:".length));
    let version = await readRequestCache(cache, maximum, sourceAlpha);
    if (version === undefined) {
      if (maximum.width === reference.width && maximum.height === reference.height && stored.data.byteLength <= policy.maxBytes) {
        version = { data: stored.data, mimeType: reference.mimeType!, width: reference.width, height: reference.height, hasAlpha: sourceAlpha };
      } else {
        version = await encodeRequestImage(stored.data, maximum, sourceAlpha, policy.maxBytes);
        await writeRequestCache(cache, version.data);
      }
    }
    return { variantId, attachment: reference, data: version.data, mimeType: version.mimeType, bytes: version.data.byteLength, width: version.width, height: version.height, depth: "uchar", space: "srgb", hasAlpha: version.hasAlpha };
  }

  async #withImageTransform<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#activeImageTransforms < this.imageCompressionConcurrency) this.#activeImageTransforms += 1;
    else await new Promise<void>((resolveWaiter) => { this.#imageTransformWaiters.push(resolveWaiter); });
    try { return await operation(); }
    finally {
      const next = this.#imageTransformWaiters.shift();
      if (next === undefined) this.#activeImageTransforms -= 1;
      else next();
    }
  }
}

export class AttachmentContextSource implements ContextSource {
  readonly name = "attachment-local";

  constructor(
    readonly attachments: AttachmentService,
    readonly maxResolvedBytes = 1024 * 1024,
  ) {}

  async contribute(
    _request: ContextRequest,
    messages: readonly AgentMessage[],
  ): Promise<ContextContribution> {
    const projected: AgentMessage[] = [];
    for (const message of messages) {
      if (message.role === "assistant") {
        projected.push(message);
      } else {
        projected.push({
          ...message,
          content: await this.#resolveBlocks(message.content),
        });
      }
    }
    return { messages: projected };
  }

  async #resolveBlocks(blocks: readonly ContentBlock[]): Promise<ContentBlock[]> {
    const resolved: ContentBlock[] = [];
    for (const block of blocks) {
      if (block.type !== "attachment") {
        resolved.push(block);
        continue;
      }
      const attachment = await this.attachments.get(block);
      if (attachment === undefined) throw new Error(`Attachment not found: ${block.id}`);
      if (attachment.mimeType.startsWith("image/")) {
        resolved.push({
          type: "image",
          data: Buffer.from(attachment.data).toString("base64"),
          mimeType: attachment.mimeType,
        });
      } else if (isText(attachment.mimeType)) {
        const data = attachment.data.subarray(0, this.maxResolvedBytes);
        const truncated = attachment.data.byteLength > data.byteLength;
        resolved.push(text(
          `[Attachment: ${attachment.name ?? block.id}]\n${Buffer.from(data).toString("utf8")}`
          + (truncated ? `\n[attachment truncated at ${this.maxResolvedBytes} bytes]` : ""),
        ));
      } else {
        resolved.push(text(
          `[Attachment ${attachment.name ?? block.id}: ${attachment.mimeType}, ${attachment.data.byteLength} bytes]`,
        ));
      }
    }
    return resolved;
  }
}

export const localAttachmentPlugin = definePlugin<LocalAttachmentConfig, SealHarnessEvents>({
  name: "attachment-local",
  provides: [attachmentServiceToken],
  requires: [contextServiceToken],
  setup(context, config) {
    const store = new LocalAttachmentStore(config.root, config);
    context.provide(attachmentServiceToken, store);
    context.effect(context.use(contextServiceToken).register(
      new AttachmentContextSource(store, config.maxResolvedBytes),
    ));
  },
});

function parseId(id: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(id);
  if (match?.[1] === undefined) throw new Error(`Invalid attachment id: ${id}`);
  return match[1];
}

function isText(mimeType: string): boolean {
  return mimeType.startsWith("text/")
    || mimeType === "application/json"
    || mimeType === "application/xml"
    || mimeType === "application/javascript";
}

interface DetectedImage {
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
  readonly animated: boolean;
  readonly carriesMetadata: boolean;
  readonly depth: string;
  readonly space: string;
  readonly hasAlpha: boolean;
}

interface NormalizedPutAttachment extends PutAttachmentRequest {
  readonly width?: number;
  readonly height?: number;
  readonly originalDimensions?: { readonly width: number; readonly height: number };
}

async function normalizeImage(
  request: PutAttachmentRequest,
  limits: ImageAttachmentLimits,
  policy: Readonly<{ maxPixels: number; maxDimension: number; maxBytes: number }>,
): Promise<NormalizedPutAttachment> {
  if (request.data.byteLength > limits.maxImageBytes) throw new Error("Image exceeds the configured byte limit");
  if (!limits.mediaTypes.includes(request.mimeType)) throw new Error(`Unsupported image type: ${request.mimeType}`);
  const detected = await detectImage(request.data);
  if (detected.mediaType !== request.mimeType) throw new Error("Declared image type does not match its bytes");
  if (detected.width * detected.height > limits.maxImagePixels || Math.max(detected.width, detected.height) > limits.maxImageDimension) throw new Error("Image exceeds the configured dimension limit");
  if (canPassThrough(detected, request.data.byteLength, policy)) return { ...request, width: detected.width, height: detected.height };
  const dimensions = normalizedDimensions(detected.width, detected.height, policy.maxPixels, policy.maxDimension);
  const pipeline = sharp(request.data, { failOn: "error", limitInputPixels: false })
    .rotate()
    .toColourspace("srgb")
    .resize({ ...dimensions, fit: "inside", withoutEnlargement: true });
  let smallest: { data: Buffer; mimeType: string; width: number; height: number } | undefined;
  for (const quality of [85, 75, 60]) {
    const encoded = detected.hasAlpha
      ? await pipeline.clone().webp({ quality, effort: 0 }).toBuffer({ resolveWithObject: true })
      : await pipeline.clone().jpeg({ quality }).toBuffer({ resolveWithObject: true });
    const candidate = { data: encoded.data, mimeType: detected.hasAlpha ? "image/webp" : "image/jpeg", width: encoded.info.width, height: encoded.info.height };
    if (smallest === undefined || candidate.data.byteLength < smallest.data.byteLength) smallest = candidate;
    if (candidate.data.byteLength <= policy.maxBytes) { smallest = candidate; break; }
  }
  if (smallest === undefined) throw new Error("Image normalization produced no output");
  const verified = await detectImage(smallest.data);
  if (verified.mediaType !== smallest.mimeType || verified.width !== smallest.width || verified.height !== smallest.height || verified.animated || verified.carriesMetadata || verified.depth !== "uchar" || verified.space !== "srgb" || (detected.mediaType !== "image/gif" && detected.hasAlpha !== verified.hasAlpha && !(detected.hasAlpha && !verified.hasAlpha && verified.mediaType === "image/webp"))) throw new Error("Image normalization verification failed");
  const downscaled = detected.width !== smallest.width || detected.height !== smallest.height;
  return { ...request, data: smallest.data, mimeType: smallest.mimeType, width: smallest.width, height: smallest.height, ...(downscaled ? { originalDimensions: { width: detected.width, height: detected.height } } : {}) };
}

async function detectImage(data: Uint8Array): Promise<DetectedImage> {
  try {
    const pipeline = sharp(data, { failOn: "error", limitInputPixels: false });
    const metadata = await pipeline.metadata();
    const mediaType = ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[String(metadata.format)];
    if (mediaType === undefined || metadata.width === undefined || metadata.height === undefined) throw new Error("unsupported image");
    await pipeline.clone().raw().toBuffer();
    const transposed = metadata.orientation !== undefined && metadata.orientation >= 5;
    return {
      mediaType,
      width: transposed ? metadata.height : metadata.width,
      height: transposed ? metadata.width : metadata.height,
      animated: (metadata.pages ?? 1) > 1,
      carriesMetadata: metadata.exif !== undefined || metadata.xmp !== undefined || metadata.iptc !== undefined || metadata.icc !== undefined || Boolean(metadata.hasProfile) || metadata.tifftagPhotoshop !== undefined || metadata.comments !== undefined || metadata.orientation !== undefined,
      depth: String(metadata.depth),
      space: String(metadata.space),
      hasAlpha: Boolean(metadata.hasAlpha),
    };
  } catch (error) {
    throw new Error("Unsupported or malformed image data", { cause: error });
  }
}

function canPassThrough(image: DetectedImage, bytes: number, policy: Readonly<{ maxPixels: number; maxDimension: number; maxBytes: number }>): boolean {
  return image.mediaType !== "image/gif" && !image.animated && !image.carriesMetadata && image.depth === "uchar" && image.space === "srgb"
    && bytes <= policy.maxBytes && image.width * image.height <= policy.maxPixels && Math.max(image.width, image.height) <= policy.maxDimension;
}

function normalizedDimensions(width: number, height: number, maxPixels: number, maxDimension: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  let normalizedWidth: number; let normalizedHeight: number;
  if (width >= height) {
    normalizedWidth = Math.max(1, Math.floor(width * scale)); normalizedHeight = Math.max(1, Math.round(normalizedWidth * height / width));
    while (normalizedWidth * normalizedHeight > maxPixels && normalizedWidth > 1) { normalizedWidth -= 1; normalizedHeight = Math.max(1, Math.round(normalizedWidth * height / width)); }
  } else {
    normalizedHeight = Math.max(1, Math.floor(height * scale)); normalizedWidth = Math.max(1, Math.round(normalizedHeight * width / height));
    while (normalizedWidth * normalizedHeight > maxPixels && normalizedHeight > 1) { normalizedHeight -= 1; normalizedWidth = Math.max(1, Math.round(normalizedHeight * width / height)); }
  }
  const longEdge = Math.max(normalizedWidth, normalizedHeight);
  if (longEdge > maxDimension) {
    const dimensionScale = maxDimension / longEdge;
    normalizedWidth = Math.max(1, Math.floor(normalizedWidth * dimensionScale));
    normalizedHeight = Math.max(1, Math.floor(normalizedHeight * dimensionScale));
  }
  return { width: normalizedWidth, height: normalizedHeight };
}

function displayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const leaf = value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1);
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return clean === "" ? undefined : clean;
}

interface RequestImageVersion {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

function requestVariantId(reference: AttachmentBlock, policy: ImageRequestPolicy): string {
  const descriptor = JSON.stringify({ transformVersion: "request-image-v5", attachmentId: reference.id, routePixelBudget: policy.maxPixels, encodedByteBudget: policy.maxBytes, encoding: { webpQualities: [85, 75, 60], webpEffort: 0, jpegQualities: [85, 75, 60], order: ["alpha:webp", "opaque:jpeg"], colourspace: "srgb" } });
  return `sha256:${createHash("sha256").update(descriptor).digest("hex")}`;
}

function requestDimensions(width: number, height: number, maxPixels: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  if (scale === 1) return { width, height };
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.floor(width * scale)); let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width));
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) { projectedWidth -= 1; projectedHeight = Math.max(1, Math.round(projectedWidth * height / width)); }
    return { width: projectedWidth, height: projectedHeight };
  }
  let projectedHeight = Math.max(1, Math.floor(height * scale)); let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height));
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) { projectedHeight -= 1; projectedWidth = Math.max(1, Math.round(projectedHeight * width / height)); }
  return { width: projectedWidth, height: projectedHeight };
}

async function encodeRequestImage(data: Uint8Array, dimensions: { width: number; height: number }, hasAlpha: boolean, maxBytes: number): Promise<RequestImageVersion> {
  const pipeline = sharp(data, { failOn: "error", limitInputPixels: false }).toColourspace("srgb").resize({ ...dimensions, fit: "inside", withoutEnlargement: true });
  let smallest: RequestImageVersion | undefined;
  for (const quality of [85, 75, 60]) {
    const encoded = hasAlpha ? await pipeline.clone().webp({ quality, effort: 0 }).toBuffer({ resolveWithObject: true }) : await pipeline.clone().jpeg({ quality }).toBuffer({ resolveWithObject: true });
    const metadata = await sharp(encoded.data, { failOn: "error", limitInputPixels: false }).metadata();
    const candidate: RequestImageVersion = { data: new Uint8Array(encoded.data), mimeType: hasAlpha ? "image/webp" : "image/jpeg", width: encoded.info.width, height: encoded.info.height, hasAlpha: Boolean(metadata.hasAlpha) };
    if (candidate.hasAlpha !== hasAlpha && !(hasAlpha && !candidate.hasAlpha && candidate.mimeType === "image/webp")) throw new Error("Encoded model-request image changed alpha semantics");
    if (smallest === undefined || candidate.data.byteLength < smallest.data.byteLength) smallest = candidate;
    if (candidate.data.byteLength <= maxBytes) return candidate;
  }
  if (smallest === undefined) throw new Error("Image request conversion produced no output");
  return smallest;
}

async function readRequestCache(path: string, maximum: { width: number; height: number }, expectedAlpha: boolean): Promise<RequestImageVersion | undefined> {
  try {
    const data = await readFile(path); const metadata = await sharp(data, { failOn: "error", limitInputPixels: false }).metadata();
    const mimeType = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : metadata.format === "png" ? "image/png" : undefined;
    const hasAlpha = Boolean(metadata.hasAlpha);
    if (mimeType === undefined || metadata.width === undefined || metadata.height === undefined || metadata.depth !== "uchar" || metadata.space !== "srgb" || metadata.width > maximum.width || metadata.height > maximum.height || (hasAlpha !== expectedAlpha && !(expectedAlpha && !hasAlpha && mimeType === "image/webp"))) return undefined;
    return { data: new Uint8Array(data), mimeType, width: metadata.width, height: metadata.height, hasAlpha };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

async function writeRequestCache(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function waitForRequest<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolveRequest, rejectRequest) => {
    let settled = false;
    const finish = (settle: () => void): void => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); settle(); };
    const abort = (): void => { finish(() => rejectRequest(signal.reason instanceof Error ? signal.reason : new Error("Attachment request cancelled", { cause: signal.reason }))); };
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) { abort(); return; }
    void operation.then((value) => { finish(() => resolveRequest(value)); }, (error: unknown) => { finish(() => rejectRequest(error)); });
  });
}
