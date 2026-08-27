import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface LocalAttachmentConfig {
  readonly root: string;
  readonly maxResolvedBytes?: number;
}

export class LocalAttachmentStore implements AttachmentService {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(request: PutAttachmentRequest): Promise<AttachmentBlock> {
    const hash = createHash("sha256").update(request.data).digest("hex");
    const id = `sha256:${hash}`;
    const directory = join(this.root, hash.slice(0, 2));
    const target = join(directory, hash);
    await mkdir(directory, { recursive: true });
    try {
      await open(target, "wx").then(async (handle) => {
        try {
          await handle.writeFile(request.data);
          await handle.sync();
        } finally {
          await handle.close();
        }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return {
      type: "attachment",
      id,
      mimeType: request.mimeType,
      ...(request.name === undefined ? {} : { name: request.name }),
    };
  }

  async get(reference: AttachmentBlock): Promise<ResolvedAttachment | undefined> {
    const hash = parseId(reference.id);
    try {
      return {
        data: await readFile(join(this.root, hash.slice(0, 2), hash)),
        mimeType: reference.mimeType ?? "application/octet-stream",
        ...(reference.name === undefined ? {} : { name: reference.name }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
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
      const data = attachment.data.subarray(0, this.maxResolvedBytes);
      const truncated = attachment.data.byteLength > data.byteLength;
      if (attachment.mimeType.startsWith("image/")) {
        resolved.push({
          type: "image",
          data: Buffer.from(data).toString("base64"),
          mimeType: attachment.mimeType,
        });
      } else if (isText(attachment.mimeType)) {
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
    const store = new LocalAttachmentStore(config.root);
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
