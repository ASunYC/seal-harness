import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { ModelInfo, ModelRequest, ModelService, ModelStreamEvent } from "@seal-harness/core";
import { createSealCodingSession } from "../src/coding-session.js";

const model: ModelInfo = { provider: "seal-test", model: "test", displayName: "Test", contextWindow: 32768, maxOutputTokens: 4096, supportsReasoning: true };
const roots: string[] = [];
const sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function open(stream: ModelService["stream"]) {
  const root = await mkdtemp(join(tmpdir(), "seal-coding-transport-test-"));
  roots.push(root);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 100 }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => "You are Seal.",
  });
  await resourceLoader.reload();
  const modelService: ModelService = { list: async () => [model], get: async () => model, stream };
  const session = await createSealCodingSession({
    request: { cwd: root, model, reasoning: "high", maxTokens: 1234 },
    modelService, agentDir: join(root, "agent"), sessionManager: SessionManager.create(root, join(root, "sessions")),
    settingsManager, resourceLoader, tools: [],
  });
  sessions.push(session);
  return { session, root };
}

describe("Seal transport embedded in the upstream coding session", () => {
  it("uses SDK prompting with Seal's model service, reasoning and request settings", async () => {
    const requests: ModelRequest[] = [];
    const { session, root } = await open(async function* (request): AsyncIterable<ModelStreamEvent> {
      requests.push(request);
      yield { type: "text_delta", delta: "hello" };
      yield { type: "done", stopReason: "stop" };
    });
    await session.prompt("hello");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: { provider: model.provider, model: model.model }, reasoning: "high", maxOutputTokens: 1234 });
    expect(requests[0]?.systemPrompt).toContain("You are Seal.");
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "hello" }] });
    const files = await readdir(root, { recursive: true });
    expect(files.some(file => /(?:auth|credentials)\.json$/.test(file))).toBe(false);
  });

  it("does not turn transport authentication failures into successful responses", async () => {
    const { session } = await open(async function* () { throw new Error("Seal credentials are missing"); });
    await session.prompt("hello");
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error", errorMessage: expect.stringContaining("Seal credentials are missing") });
  });

  it("routes SDK compaction through the same Seal transport", async () => {
    const requests: ModelRequest[] = [];
    const { session } = await open(async function* (request) {
      requests.push(request);
      yield { type: "text_delta", delta: "Summary: keep this context." };
      yield { type: "done", stopReason: "stop" };
    });
    for (let i = 0; i < 5; i++) await session.prompt(`turn ${i}: ${"context ".repeat(100)}`);
    const count = requests.length;
    const result = await session.compact();
    expect(result.summary).toContain("keep this context");
    expect(requests.length).toBeGreaterThan(count);
    expect(session.sessionManager.getEntries().some(entry => entry.type === "compaction")).toBe(true);
  });
});
