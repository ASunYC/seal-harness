import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runId, sessionId, userMessage, type AgentMessage, type ModelInfo, type ModelRequest, type ModelService } from "@seal-harness/core";
import { PiAgentRuntime } from "../src/runtime.js";
import { openNativeSession } from "../src/session-storage.js";
import { createSealCodingSession } from "../src/coding-session.js";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const model: ModelInfo = { provider: "test", model: "fixture", displayName: "Fixture", contextWindow: 32768, maxOutputTokens: 4096, supportsReasoning: true };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(stream?: ModelService["stream"]) {
  const root = await mkdtemp(join(tmpdir(), "seal-native-runtime-test-")); roots.push(root);
  const requests: ModelRequest[] = [];
  const models: ModelService = { list: async () => [model], get: async () => model, stream: stream ?? (async function* (request) {
    requests.push(request);
    yield { type: "text_delta", delta: "PI native response" };
    yield { type: "done", stopReason: "stop" };
  }) };
  async function run(prompt: string, history: readonly AgentMessage[] = []) {
    const input = userMessage(prompt);
    const execution = new PiAgentRuntime(models, undefined, { dataHome: root }).start({
      runId: runId(`run-${requests.length}`), sessionId: sessionId("native-test"), cwd: root, model,
      systemPrompt: "Seal", messages: [...history, input], inputMessages: [input],
    });
    return execution.result;
  }
  return { root, requests, models, run };
}

describe("native PI persistence in the actual Seal runtime", () => {
  it.each(["failure", "abort"] as const)("preserves history when native compaction ends with %s", async outcome => {
    let announce!: () => void; const entered = new Promise<void>(resolve => { announce = resolve; });
    let agentCalls = 0;
    const f = await fixture(async function* (request) {
      if (request.systemPrompt.includes("context summarization assistant")) {
        announce();
        if (outcome === "abort") await new Promise<void>(resolve => {
          if (request.signal.aborted) resolve(); else request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("summary fixture failed");
      }
      agentCalls++;
      expect(JSON.stringify(request.messages)).toContain("preserved-0");
      yield { type: "text_delta", delta: "continued with original history" };
      yield { type: "usage", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      yield { type: "done", stopReason: "stop" };
    });
    const history: AgentMessage[] = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user",
      content: [{ type: "text", text: `preserved-${i} ${"history ".repeat(3000)}` }] }));
    const input = userMessage("continue");
    const run = new PiAgentRuntime(f.models, undefined, { dataHome: f.root, compaction: { keepRecentTokens: 100 } }).start({
      runId: runId(outcome), sessionId: sessionId(outcome), cwd: f.root, model, systemPrompt: "Seal",
      messages: [...history, input], inputMessages: [input],
    });
    const collected = (async () => { const events = []; for await (const event of run) events.push(event); return events; })();
    await entered; if (outcome === "abort") run.abort();
    const result = await run.result; const events = await collected;
    expect(result.stopReason).toBe(outcome === "abort" ? "aborted" : "stop");
    expect(agentCalls).toBe(outcome === "abort" ? 0 : 1);
    expect(events).toContainEqual(expect.objectContaining({ type: "compaction_activity", state: "finished", outcome: outcome === "abort" ? "aborted" : "failed" }));
    expect(events.some(event => event.type === "context_compacted")).toBe(false);
    const lease = await openNativeSession(f.root, outcome, f.root);
    try {
      expect(lease.manager.getEntries().some(entry => entry.type === "compaction")).toBe(false);
      expect(JSON.stringify(lease.manager.buildSessionContext())).toContain("preserved-0");
    } finally { await lease.release(); }
  });

  it.each([true, false])("bridges SDK automatic compaction lifecycle and settings (enabled: %s)", async enabled => {
    const f = await fixture(async function* () {
      yield { type: "text_delta", delta: "Native summary or reply" };
      yield { type: "usage", usage: { inputTokens: 32000, outputTokens: 10, totalTokens: 32010 } };
      yield { type: "done", stopReason: "stop" };
    });
    const events: import("@seal-harness/core").RuntimeEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const input = userMessage(`turn-${i}: ${"history ".repeat(200)}`);
      const run = new PiAgentRuntime(f.models, undefined, { dataHome: f.root,
        compaction: { enabled, reserveTokens: 4096, keepRecentTokens: 100 } }).start({
        runId: runId(`compact-${i}`), sessionId: sessionId("automatic-native"), cwd: f.root, model,
        systemPrompt: "Seal", messages: [input], inputMessages: [input],
      });
      for await (const event of run) events.push(event);
      expect((await run.result).stopReason).toBe("stop");
    }
    const lifecycle = events.filter(event => event.type === "compaction_activity");
    if (!enabled) { expect(lifecycle).toEqual([]); return; }
    expect(lifecycle.length).toBeGreaterThan(0);
    expect(lifecycle.length % 2).toBe(0);
    for (let i = 0; i < lifecycle.length; i += 2) {
      expect(lifecycle[i]).toMatchObject({ state: "started", reason: "threshold" });
      expect(lifecycle[i + 1]).toMatchObject({ state: "finished", reason: "threshold", outcome: "completed" });
    }
    expect(events.at(-1)?.type).toBe("run_end");
    const lease = await openNativeSession(f.root, "automatic-native", f.root);
    try { expect(lease.manager.getEntries().some(entry => entry.type === "compaction")).toBe(true); }
    finally { await lease.release(); }
  });

  it("restores prior turns across runtime instances without replaying stale Seal history", async () => {
    const f = await fixture();
    const first = await f.run("first input");
    expect(first.stopReason).toBe("stop");
    const files = (await readdir(join(f.root, "pi-sessions"))).filter(file => file.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const file = join(f.root, "pi-sessions", files[0]!);
    const before = await readFile(file, "utf8");
    const second = await f.run("second input", [userMessage("stale projection, must not be imported")]);
    expect(second.stopReason).toBe("stop");
    const content = JSON.stringify(f.requests.at(-1)?.messages);
    expect(content).toContain("first input");
    expect(content).toContain("second input");
    expect(content).not.toContain("stale projection");
    expect((await readFile(file, "utf8")).startsWith(before)).toBe(true);
    expect((await readdir(join(f.root, "pi-sessions"))).some(file => file.endsWith(".lease"))).toBe(false);
  });

  it("does not permit a second native writer while a lease is held", async () => {
    const f = await fixture();
    const lease = await openNativeSession(f.root, "native-test", f.root);
    try {
      const result = await f.run("must not run");
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("writer lease");
      expect(f.requests).toHaveLength(0);
    } finally { await lease.release(); }
    expect((await f.run("after release")).stopReason).toBe("stop");
  });

  it("retains native compaction when the next runtime instance starts", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) expect((await f.run(`old-${i}: ${"context ".repeat(100)}`)).stopReason).toBe("stop");
    const lease = await openNativeSession(f.root, "native-test", f.root);
    const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 100, reserveTokens: 1024 } });
    const loader = new DefaultResourceLoader({ cwd: f.root, agentDir: f.root, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    await loader.reload();
    const session = await createSealCodingSession({ request: { cwd: f.root, model }, modelService: f.models,
      agentDir: f.root, sessionManager: lease.manager, settingsManager: settings, resourceLoader: loader, tools: [] });
    try { await session.compact(); } finally { session.dispose(); await lease.release(); }
    expect((await f.run("after compaction")).stopReason).toBe("stop");
    const content = JSON.stringify(f.requests.at(-1)?.messages);
    expect(content).toContain("PI native response");
    expect(content).not.toContain("old-0:");
    expect(content).toContain("after compaction");
  });
});
