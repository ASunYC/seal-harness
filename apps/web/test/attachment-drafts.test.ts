import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/attachment-drafts.js")).href;

describe("session-scoped attachment drafts", () => {
  it("isolates and restores drafts across session switches", async () => {
    const { AttachmentDraftStore } = await import(moduleUrl); const store = new AttachmentDraftStore(); const a = [{ id: "a" }];
    expect(store.switch(null, "one", [])).toEqual([]); store.update("one", a);
    expect(store.switch("one", "two", a)).toEqual([]); store.update("two", [{ id: "b" }]);
    expect(store.switch("two", "one", [{ id: "b" }])).toEqual(a);
  });

  it("moves the blank draft to its minted session and consumes identities everywhere", async () => {
    const { AttachmentDraftStore } = await import(moduleUrl); const store = new AttachmentDraftStore(); const shared = { id: "sent" };
    store.update(null, [shared]); store.adopt(null, "minted", [shared]); expect(store.switch("minted", null, [shared])).toEqual([]);
    store.update("other", [shared, { id: "keep" }]); store.removeEverywhere([shared]);
    expect(store.switch(null, "minted", [])).toEqual([]); expect(store.switch("minted", "other", [])).toEqual([{ id: "keep" }]);
  });
});
