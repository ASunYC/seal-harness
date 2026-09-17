import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { messageId, sessionId, type AgentMessage } from "@seal-harness/core";
import { fromPiMessages } from "../src/messages.js";
import { importSealHistory } from "../src/session-import.js";

const model: Model<"openai-completions"> = {
  id: "fixture", name: "Fixture", provider: "fixture", api: "openai-completions", baseUrl: "https://unused.invalid",
  reasoning: true, input: ["text", "image"], contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const id = sessionId("seal-existing");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const history: readonly AgentMessage[] = [
  { role: "user", id: messageId("original-user"), source: { kind: "user-rpc", rpcId: "original-request" }, content: [
    { type: "text", text: "remember" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
  ] },
  { role: "assistant", content: [{ type: "text", text: "remembered" }] },
];

describe("one-time Seal history import into PI", () => {
  it("persists metadata and images without mutating or duplicating source history", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-pi-import-test-")); roots.push(root);
    const before = structuredClone(history);
    const manager = SessionManager.create(root, root);
    expect(importSealHistory(manager, id, history, model)).toBe("imported");
    const file = manager.getSessionFile()!;
    const text = await readFile(file, "utf8");
    const reopened = SessionManager.open(file);
    expect(fromPiMessages(reopened.buildSessionContext().messages)[0]).toEqual(history[0]);
    expect(history).toEqual(before);
    expect(importSealHistory(reopened, id, history, model)).toBe("already-imported");
    expect(await readFile(file, "utf8")).toBe(text);
  });

  it("rejects a native session belonging to another Seal session", () => {
    const manager = SessionManager.inMemory();
    importSealHistory(manager, id, history, model);
    expect(() => importSealHistory(manager, sessionId("other"), history, model)).toThrow("different Seal session");
  });

  it("rejects interrupted imports without appending more records", () => {
    const manager = SessionManager.inMemory();
    manager.appendCustomEntry("seal-history-import-start", { sealSessionId: id, digest: "partial" });
    const before = manager.getEntries();
    expect(() => importSealHistory(manager, id, history, model)).toThrow("Incomplete Seal history import");
    expect(manager.getEntries()).toEqual(before);
  });

  it("validates all attachments before writing the first entry", () => {
    const manager = SessionManager.inMemory();
    const invalid = [...history, { role: "assistant" as const, content: [{ type: "image" as const, data: "a", mimeType: "image/png" }] }];
    expect(() => importSealHistory(manager, id, invalid, model)).toThrow("assistant images");
    expect(manager.getEntries()).toEqual([]);
  });

  it("will not merge legacy history into an unrelated native transcript", () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: "native history", timestamp: 1 });
    expect(() => importSealHistory(manager, id, history, model)).toThrow("empty PI session");
    expect(manager.getEntries()).toHaveLength(1);
  });
});
