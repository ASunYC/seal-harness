import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/conversation-draft.js")).href;

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), values };
}

describe("DSH-compatible conversation drafts", () => {
  it("isolates drafts by Session and survives a new module read", async () => {
    const { readConversationDraft, writeConversationDraft } = await import(moduleUrl); const storage = memoryStorage();
    writeConversationDraft(storage, "one", "draft one"); writeConversationDraft(storage, "two", "draft two");
    expect(readConversationDraft(storage, "one")).toBe("draft one"); expect(readConversationDraft(storage, "two")).toBe("draft two");
  });
  it("uses the DSH persistence key and preserves other conversation state", async () => {
    const { conversationDraftKey, readConversationDraft, writeConversationDraft } = await import(moduleUrl);
    const key = conversationDraftKey("session-1"); const storage = memoryStorage({ [key]: JSON.stringify({ draft: "old", view: "trajectory" }) });
    expect(key).toBe("dsh.conversation.session-1"); writeConversationDraft(storage, "session-1", "next");
    expect(JSON.parse(storage.values.get(key)!)).toEqual({ draft: "next", view: "trajectory" }); expect(readConversationDraft(storage, "session-1")).toBe("next");
  });
  it("recovers from malformed storage", async () => {
    const { readConversationDraft } = await import(moduleUrl); const storage = memoryStorage({ "dsh.conversation.bad": "{" });
    expect(readConversationDraft(storage, "bad")).toBe("");
  });
});
