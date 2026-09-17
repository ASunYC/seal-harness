import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime,
  SessionManager, SettingsManager,
  type AgentSession, type AgentSessionEvent, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage, type Context, type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";

// Exercise the actual published SDK. Only the provider transport is controlled;
// no Agent, AgentSession, persistence, queue or compaction method is mocked.
const roots: string[] = [];
const sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type Respond = (context: Context, options?: SimpleStreamOptions) => Promise<AssistantMessage["content"]>;
async function fixture(respond: Respond, customTools: ToolDefinition[] = [], inputTokens = 30) {
  const root = await mkdtemp(join(tmpdir(), "seal-pi-sdk-test-"));
  roots.push(root);
  const requests: Context[] = [];
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false,
  });
  modelRuntime.registerProvider("seal-sdk-test", {
    api: "openai-completions", apiKey: "fixture-not-a-real-key", baseUrl: "https://unused.invalid",
    models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 }],
    streamSimple(model, context, options) {
      const output = createAssistantMessageEventStream();
      const partial: AssistantMessage = {
        role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: inputTokens, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: inputTokens + 10,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      };
      requests.push({ ...context, messages: structuredClone(context.messages) });
      void (async () => {
        output.push({ type: "start", partial });
        try {
          partial.content = await respond(context, options);
          options?.signal?.throwIfAborted();
          for (const [contentIndex, block] of partial.content.entries()) {
            if (block.type === "text") output.push({ type: "text_delta", contentIndex, delta: block.text, partial });
          }
          partial.stopReason = partial.content.some(block => block.type === "toolCall") ? "toolUse" : "stop";
          output.push({ type: "done", reason: partial.stopReason, message: partial });
        } catch (error) {
          partial.stopReason = options?.signal?.aborted ? "aborted" : "error";
          partial.errorMessage = String(error);
          output.push({ type: "error", reason: partial.stopReason, error: partial });
        }
        output.end();
      })();
      return output;
    },
  });
  async function open(sessionManager = SessionManager.create(root, join(root, "sessions")), autoCompact = false) {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: autoCompact, reserveTokens: 1024, keepRecentTokens: 100 }, retry: { enabled: false },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: root, agentDir: join(root, "agent"), settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: root, agentDir: join(root, "agent"), modelRuntime,
      model: modelRuntime.getModel("seal-sdk-test", "fixture")!, thinkingLevel: "off",
      sessionManager, settingsManager, resourceLoader, tools: customTools.map(tool => tool.name), customTools,
    });
    sessions.push(session);
    const events: AgentSessionEvent[] = [];
    session.subscribe(event => { events.push(event); });
    return { session, events };
  }
  return { root, requests, open };
}

describe("unmodified PI coding-agent SDK migration contract", () => {
  it("creates a native session and publishes streamed text", async () => {
    const f = await fixture(async () => [{ type: "text", text: "hello Seal" }]);
    const { session, events } = await f.open();
    await session.prompt("hello");
    expect(session.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(events.some(event => event.type === "message_update" && event.assistantMessageEvent.type === "text_delta")).toBe(true);
    expect(f.requests).toHaveLength(1);
  });

  it("executes a custom tool and lets PI continue the loop", async () => {
    let calls = 0;
    const tool: ToolDefinition = { name: "seal_echo", label: "Echo", description: "Echo input",
      parameters: Type.Object({ value: Type.String() }),
      async execute(_id, params) { calls++; return { content: [{ type: "text", text: (params as { value: string }).value }], details: {} }; },
    };
    const f = await fixture(async context => context.messages.some(message => message.role === "toolResult")
      ? [{ type: "text", text: "done" }]
      : [{ type: "toolCall", id: "echo-1", name: "seal_echo", arguments: { value: "ping" } }], [tool]);
    const { session, events } = await f.open();
    await session.prompt("echo ping");
    expect(calls, JSON.stringify(session.messages)).toBe(1);
    expect(f.requests).toHaveLength(2);
    expect(events.some(event => event.type === "tool_execution_end")).toBe(true);
    expect(session.messages.at(-1)).toMatchObject({ content: [{ type: "text", text: "done" }] });
  });

  it("aborts an active provider through the public session API", async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const f = await fixture(async (_context, options) => {
      entered();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("aborted"));
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener("abort", abort, { once: true });
      });
      return [];
    });
    const { session } = await f.open();
    const pending = session.prompt("wait");
    await ready;
    await session.abort();
    await pending;
    expect(session.isStreaming).toBe(false);
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "aborted" });
  });

  it("reopens PI JSONL without rewriting existing history", async () => {
    const f = await fixture(async () => [{ type: "text", text: "remembered" }]);
    const first = await f.open();
    await first.session.prompt("remember this");
    const file = first.session.sessionFile!;
    const before = await readFile(file, "utf8");
    first.session.dispose();
    const second = await f.open(SessionManager.open(file));
    expect(second.session.messages).toEqual(first.session.messages);
    await second.session.prompt("continue");
    expect(f.requests.at(-1)?.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("remember this"))).toBe(true);
    expect((await readFile(file, "utf8")).startsWith(before)).toBe(true);
  });

  it("compacts through PI and restores the compacted session", async () => {
    const f = await fixture(async () => [{ type: "text", text: "Summary of previous work." }]);
    const { session, events } = await f.open();
    for (let i = 0; i < 5; i++) await session.prompt(`turn ${i}: ${"context ".repeat(100)}`);
    const result = await session.compact();
    expect(result.summary).toContain("Summary");
    expect(events.some(event => event.type === "compaction_start")).toBe(true);
    expect(session.sessionManager.getEntries().some(entry => entry.type === "compaction")).toBe(true);
    const file = session.sessionFile!;
    session.dispose();
    const restored = await f.open(SessionManager.open(file));
    expect(restored.session.messages).toEqual(session.messages);
  });

  it("lets PI automatically compact when provider usage crosses its threshold", async () => {
    const f = await fixture(async () => [{ type: "text", text: "Summary of previous work." }], [], 32000);
    const { session, events } = await f.open(undefined, true);
    for (let i = 0; i < 5; i++) await session.prompt(`turn ${i}: ${"context ".repeat(100)}`);
    expect(events.some(event => event.type === "compaction_start"), JSON.stringify({ settings: session.settingsManager.getCompactionSettings(), model: session.model, last: session.messages.at(-1), events: events.map(event => event.type) })).toBe(true);
    expect(session.sessionManager.getEntries().some(entry => entry.type === "compaction")).toBe(true);
    expect(session.isStreaming).toBe(false);
  });

  it("delivers a follow-up through the public SDK queue", async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    const f = await fixture(async () => {
      if (++requests === 1) { entered(); await gate; }
      return [{ type: "text", text: "done" }];
    });
    const { session } = await f.open();
    const running = session.prompt("first");
    await ready;
    await session.followUp("second");
    expect(session.getFollowUpMessages()).toEqual(["second"]);
    release();
    await running;
    expect(requests).toBe(2);
    expect(session.pendingMessageCount).toBe(0);
    expect(session.messages.filter(message => message.role === "user")).toHaveLength(2);
  });
});
