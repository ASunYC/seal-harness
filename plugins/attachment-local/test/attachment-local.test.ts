import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionId, text } from "@piharness/core";
import { AttachmentContextSource, LocalAttachmentStore } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("local attachments", () => {
  it("deduplicates content and resolves text without changing the durable reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "piharness-attachments-"));
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
  });
});
