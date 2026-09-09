import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/queue-dock.js")).href;

describe("queue dock projection", () => {
  const queued = { id: "m1", placement: "queued", message: { content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] } };
  it("projects text and a stable render key", async () => {
    const { queueDockItems, queueEditableText, queueImageRefs, queueImageUrl, queueItemPreview, queueItemText, queueSnapshotKey } = await import(moduleUrl);
    expect(queueItemText(queued)).toBe("first\nsecond");
    expect(queueSnapshotKey([queued])).toBe(queueSnapshotKey([{ ...queued }]));
    expect(queueSnapshotKey([{ ...queued, placement: "steering" }])).not.toBe(queueSnapshotKey([queued]));
    expect(queueDockItems([queued, { ...queued, id: "m2", placement: "steering" }])).toEqual([queued]);
    expect(queueItemPreview({ message: { content: [{ type: "text", text: " first\n\tsecond " }, { type: "seal/attachment" }] } })).toBe("first second [seal/attachment]");
    expect(queueItemPreview({ message: { content: [{ type: "text", text: "😀".repeat(201) }] } })).toBe(`${"😀".repeat(200)}…`);
    expect(queueItemPreview({ message: { content: [{ type: "image" }] } })).toBe("");
    expect(queueImageRefs({ message: { content: [{ type: "seal/attachment", id: "a1", mimeType: "image/png", name: "shot.png" }, { type: "seal/attachment", id: "a2", mimeType: "text/plain" }] } })).toEqual([{ id: "a1", mimeType: "image/png", name: "shot.png" }]);
    expect(queueImageRefs({ message: { content: [{ type: "image", attachment: { attachmentId: "a3", mediaType: "image/webp" } }] } })).toEqual([{ id: "a3", mimeType: "image/webp", name: undefined }]);
    expect(queueImageUrl({ id: "sha256:abc", name: "a b.png", mimeType: "image/png" }, "session/a", false)).toBe("/api/sessions/session%2Fa/attachment-content/sha256%3Aabc?name=a+b.png&mimeType=image%2Fpng");
    expect(queueImageUrl({ id: "sha256:abc" }, "session/a", true)).toBe("/api/attachments/sha256%3Aabc");
    expect(queueEditableText(queued)).toBe("firstsecond");
    expect(queueEditableText({ message: { content: [{ type: "text", text: "caption" }, { type: "seal/attachment", id: "a1" }] } })).toBeNull();
  });
  it("only offers steering for a queued item while running", async () => {
    const { canAccelerateQueuedMessages, canSteerQueueItem, shouldSteerQueueOnAcceleratedEnter } = await import(moduleUrl);
    expect(canSteerQueueItem(queued, true)).toBe(true);
    expect(canSteerQueueItem(queued, false)).toBe(false);
    expect(canSteerQueueItem({ ...queued, placement: "steering" }, true)).toBe(false);
    expect(shouldSteerQueueOnAcceleratedEnter({ draft: "  ", attachmentCount: 0, running: true, items: [queued], accelerated: true })).toBe(true);
    expect(shouldSteerQueueOnAcceleratedEnter({ draft: "new", attachmentCount: 0, running: true, items: [queued], accelerated: true })).toBe(false);
    expect(shouldSteerQueueOnAcceleratedEnter({ draft: "", attachmentCount: 1, running: true, items: [queued], accelerated: true })).toBe(false);
    expect(shouldSteerQueueOnAcceleratedEnter({ draft: "", attachmentCount: 0, running: true, items: [queued], accelerated: false })).toBe(false);
    expect(shouldSteerQueueOnAcceleratedEnter({ draft: "", attachmentCount: 0, running: false, items: [queued], accelerated: true })).toBe(false);
    expect(canAccelerateQueuedMessages({ draft: "", attachmentCount: 0, running: true, items: [queued] })).toBe(true);
  });
  it("keeps only submissions that have not appeared in the durable queue", async () => {
    const { pendingQueueItems } = await import(moduleUrl);
    const pending = [
      { requestId: "rpc-1", sessionId: "s1", placement: "queued" },
      { requestId: "rpc-2", sessionId: "s1", placement: "queued" },
      { requestId: "rpc-3", sessionId: "s1", placement: "steering" },
      { requestId: "rpc-4", sessionId: "s2", placement: "queued" },
    ];
    expect(pendingQueueItems([{ ...queued, rpcId: "rpc-1" }], pending, "s1")).toEqual([pending[1]]);
  });
  it("makes subagent queues read-only", async () => {
    const { queueMutable } = await import(moduleUrl);
    expect(queueMutable("root", [{ id: "root" }, { id: "child", origin: "subagent" }])).toBe(true);
    expect(queueMutable("child", [{ id: "root" }, { id: "child", origin: "subagent" }])).toBe(false);
  });
});
