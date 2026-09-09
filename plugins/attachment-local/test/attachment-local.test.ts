import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { sessionId, text } from "@seal-harness/core";
import { AttachmentContextSource, LocalAttachmentStore } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("local attachments", () => {
  it("deduplicates content and resolves text without changing the durable reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-harness-attachments-"));
    temporary.push(root);
    const store = new LocalAttachmentStore(root);
    const first = await store.put({
      data: Buffer.from("hello attachment"),
      mimeType: "text/plain",
      name: "hello.txt",
    });
    const second = await store.put({
      data: Buffer.from("hello attachment"),
      mimeType: "text/plain",
    });
    expect(first.id).toBe(second.id);
    await expect(store.get(first)).resolves.toMatchObject({
      mimeType: "text/plain",
      name: "hello.txt",
    });

    const durable = { role: "user" as const, content: [text("inspect"), first] };
    const source = new AttachmentContextSource(store);
    const contribution = await source.contribute({
      sessionId: sessionId("session"),
      cwd: root,
      history: [],
      prompt: [],
      signal: new AbortController().signal,
    }, [durable]);

    expect(durable.content[1]).toEqual(first);
    expect(contribution.messages?.[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "inspect" },
        { type: "text", text: expect.stringContaining("hello attachment") },
      ],
    });

    const hash = first.id.slice("sha256:".length); const objectPath = join(root, hash.slice(0, 2), hash);
    await chmod(objectPath, 0o600); await writeFile(objectPath, "corrupt");
    await expect(store.get(first)).rejects.toThrow("integrity verification");
  });

  it("normalizes large and alpha images into bounded provider-independent files", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-harness-attachments-"));
    temporary.push(root);
    const store = new LocalAttachmentStore(root);
    const large = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#336699" } }).png().toBuffer();
    const normalized = await store.put({ data: large, mimeType: "image/png", name: "C:\\Users\\person\\large.png\u0000" });
    expect(normalized.mimeType).toBe("image/jpeg");
    expect(normalized.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(normalized).toMatchObject({ name: "large.png", width: expect.any(Number), height: expect.any(Number), originalDimensions: { width: 3000, height: 2000 } });
    const resolved = await store.get(normalized);
    const metadata = await sharp(resolved?.data).metadata();
    expect((metadata.width ?? 0) * (metadata.height ?? 0)).toBeLessThanOrEqual(2048 * 2048);
    expect(metadata).toMatchObject({ format: "jpeg", depth: "uchar", space: "srgb" });
    expect(metadata.pages ?? 1).toBe(1);

    const request = await store.readImageRequest(normalized, { maxPixels: 10_000, maxBytes: 4096 });
    expect(request).toMatchObject({ attachment: normalized, width: expect.any(Number), height: expect.any(Number), depth: "uchar", space: "srgb" });
    expect(request.width * request.height).toBeLessThanOrEqual(10_000);
    const variantHash = request.variantId.slice("sha256:".length); const cachePath = join(root, "request-images", variantHash.slice(0, 2), variantHash);
    expect(await readFile(cachePath)).toEqual(Buffer.from(request.data));
    const restarted = new LocalAttachmentStore(root);
    await expect(restarted.readImageRequest(normalized, { maxPixels: 10_000, maxBytes: 4096 })).resolves.toEqual(request);
    await writeFile(cachePath, "invalid cache");
    const repaired = await restarted.readImageRequest(normalized, { maxPixels: 10_000, maxBytes: 4096 });
    expect(repaired).toMatchObject({ variantId: request.variantId, width: request.width, height: request.height });
    expect(repaired.data).not.toEqual(new TextEncoder().encode("invalid cache"));

    const alpha = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png().withMetadata({ orientation: 6 }).toBuffer();
    const alphaRef = await store.put({ data: alpha, mimeType: "image/png" });
    expect(alphaRef.mimeType).toBe("image/webp");
    const alphaMetadata = await sharp((await store.get(alphaRef))?.data).metadata();
    expect(alphaMetadata).toMatchObject({ format: "webp", width: 8, height: 8, hasAlpha: true });
    expect(alphaMetadata.orientation).toBeUndefined();

    const clean = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#abcdef" } }).jpeg().toBuffer();
    const cleanRef = await store.put({ data: clean, mimeType: "image/jpeg", name: "clean.jpg" });
    expect((await store.get(cleanRef))?.data).toEqual(clean);
    expect(cleanRef).toMatchObject({ mimeType: "image/jpeg", width: 4, height: 4 });
    expect(cleanRef.originalDimensions).toBeUndefined();
  });

  it("never truncates normalized image bytes at the text preview limit", async () => {
    const image = Buffer.alloc(1024 * 1024 + 17, 7);
    const source = new AttachmentContextSource({
      async put() { throw new Error("not used"); },
      async get() { return { data: image, mimeType: "image/webp", name: "large.webp" }; },
    }, 32);
    const contribution = await source.contribute({
      sessionId: sessionId("session"), cwd: process.cwd(), history: [], prompt: [], signal: new AbortController().signal,
    }, [{ role: "user", content: [{ type: "attachment", id: `sha256:${"a".repeat(64)}`, mimeType: "image/webp" }] }]);
    const block = contribution.messages?.[0]?.content[0];
    expect(block?.type).toBe("image");
    if (block?.type === "image") expect(Buffer.from(block.data, "base64")).toEqual(image);
  });

  it("validates normalization and compression concurrency configuration", async () => {
    expect(() => new LocalAttachmentStore(".", { normalizedImageMaxBytes: 0 })).toThrow("maxBytes must be a positive integer");
    expect(() => new LocalAttachmentStore(".", { imageCompressionConcurrency: 9 })).toThrow("integer from 1 through 8");
    expect(new LocalAttachmentStore(".").imageCompressionConcurrency).toBe(2);
  });
});
