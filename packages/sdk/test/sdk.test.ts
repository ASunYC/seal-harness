import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SealHarness } from "../src/index.js";

const FAKE_RPC = String.raw`
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.jsonrpc !== "2.0") { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32600, message: "missing JSON-RPC version" } }) + "\n"); return; }
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: request.id, result: { serverInfo: { name: "fake", version: "1" } } }) + "\n");
  } else if (request.method === "prompt") {
    if (request.params.prompt === "tree") {
      process.stdout.write(JSON.stringify({ method: "subagent.started", params: { requestId: request.id, parentSessionId: request.params.sessionId, childSessionId: "tree-child" } }) + "\n");
      process.stdout.write(JSON.stringify({ method: "event", params: { requestId: request.id, sessionId: "tree-child", event: { type: "text_delta", delta: "child" } } }) + "\n");
      process.stdout.write(JSON.stringify({ method: "event", params: { requestId: request.id, sessionId: "unrelated", event: { type: "text_delta", delta: "other" } } }) + "\n");
    }
    const event = { type: "text_delta", delta: "sdk-ok:" + request.params.prompt };
    process.stdout.write(JSON.stringify({ method: "event", params: { requestId: request.id, sessionId: request.params.sessionId, event } }) + "\n");
    process.stdout.write(JSON.stringify({ id: request.id, result: { sessionId: request.params.sessionId, runId: "run-1", stopReason: "stop" } }) + "\n");
  } else if (request.method === "shutdown") {
    process.stdout.write(JSON.stringify({ id: request.id, result: { stopped: true } }) + "\n");
    process.exitCode = 0;
    lines.close();
  }
});`;

describe("SealHarness SDK", () => {
  it("sends DeepSeek Harness-compatible initialization options and maxTokens", async () => {
    const runtime = String.raw`
      const readline = require("node:readline");
      const lines = readline.createInterface({ input: process.stdin });
      let initialized = false;
      lines.on("line", (line) => {
        const request = JSON.parse(line);
        if (request.method === "initialize") {
          initialized = request.params.provider === "fixture" && request.params.model === "model"
            && request.params.reasoningEffort === "high" && request.params.maxTokens === 2048;
          process.stdout.write(JSON.stringify({ id: request.id, result: { serverInfo: { name: "fake", version: "1" } } }) + "\n");
        } else if (request.method === "prompt") {
          const ok = initialized && request.params.reasoning === "high" && request.params.maxTokens === 2048;
          process.stdout.write(JSON.stringify({ method: "event", params: { requestId: request.id, sessionId: request.params.sessionId, event: { type: "text_delta", delta: ok ? "compatible" : "mismatch" } } }) + "\n");
          process.stdout.write(JSON.stringify({ id: request.id, result: { sessionId: request.params.sessionId, runId: "run", stopReason: "stop" } }) + "\n");
        } else if (request.method === "shutdown") {
          process.stdout.write(JSON.stringify({ id: request.id, result: { stopped: true } }) + "\n"); lines.close();
        }
      });`;
    await using harness = new SealHarness({ command: process.execPath, args: ["-e", runtime], provider: "fixture", model: "model", reasoningEffort: "high", maxTokens: 2048 });
    await expect(harness.run("hello")).resolves.toMatchObject({ finalResponse: "compatible" });
    expect(() => new SealHarness({ maxTokens: 0 })).toThrow("maxTokens must be a positive integer");
  });

  it("runs through the real RPC server and Agent stack", async () => {
    const imports = {
      rpc: new URL("../../../apps/rpc/dist/index.js", import.meta.url).href,
      host: new URL("../../host/dist/index.js", import.meta.url).href,
      kernel: new URL("../../kernel/dist/index.js", import.meta.url).href,
      model: new URL("../../../plugins/model-scripted/dist/index.js", import.meta.url).href,
      session: new URL("../../../plugins/session-memory/dist/index.js", import.meta.url).href,
      context: new URL("../../../plugins/context-core/dist/index.js", import.meta.url).href,
      runtime: new URL("../../../plugins/runtime-pi/dist/index.js", import.meta.url).href,
      agent: new URL("../../../plugins/agent-core/dist/index.js", import.meta.url).href,
    };
    const runtime = `
      import { runRpcServer } from ${JSON.stringify(imports.rpc)};
      import { defineProfile } from ${JSON.stringify(imports.host)};
      import { plugin } from ${JSON.stringify(imports.kernel)};
      import { scriptedModelPlugin } from ${JSON.stringify(imports.model)};
      import { memorySessionPlugin } from ${JSON.stringify(imports.session)};
      import { contextCorePlugin } from ${JSON.stringify(imports.context)};
      import { piRuntimePlugin } from ${JSON.stringify(imports.runtime)};
      import { agentCorePlugin } from ${JSON.stringify(imports.agent)};
      const profile = defineProfile([
        plugin(scriptedModelPlugin, { models: [{ provider: "sdk", model: "real", contextWindow: 1000, maxOutputTokens: 100 }], async *respond() { yield { type: "text_delta", delta: "real-stack-ok" }; yield { type: "done", stopReason: "stop" }; } }),
        plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
        plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
      ]);
      await runRpcServer(profile, { input: process.stdin, output: process.stdout });
    `;
    await using harness = new SealHarness({
      command: process.execPath,
      args: ["--input-type=module", "-e", runtime],
      provider: "sdk",
      model: "real",
    });
    const result = await harness.run("hello", { sessionId: "real-stack" });
    expect(result.finalResponse).toBe("real-stack-ok");
    expect(result.finishReason).toBe("stop");
    expect(result.events).toEqual(expect.arrayContaining([
      { type: "text_delta", delta: "real-stack-ok" },
    ]));
  });

  it("owns the subprocess, reuses sessions, and collects streaming notifications", async () => {
    const harness = new SealHarness({
      command: process.execPath,
      args: ["-e", FAKE_RPC],
      cwd: process.cwd(),
      provider: "custom",
      model: "model",
    });
    const seen: string[] = [];
    try {
      const session = harness.session("stable-session");
      const first = await session.run("one", {
        onNotification(notification) { seen.push(notification.method); },
      });
      const second = await session.run("two");
      expect(first).toEqual(expect.objectContaining({
        sessionId: "stable-session", runId: "run-1", finishReason: "stop", finalResponse: "sdk-ok:one",
      }));
      expect(second.finalResponse).toBe("sdk-ok:two");
      expect(first.events).toEqual([{ type: "text_delta", delta: "sdk-ok:one" }]);
      expect(seen).toEqual(["event"]);
    } finally {
      await harness.close();
    }
    await expect(harness.start()).rejects.toThrow("closed");
  });

  it("supports filtered pull subscriptions and drops their queue on explicit close", async () => {
    const harness = new SealHarness({ command: process.execPath, args: ["-e", FAKE_RPC] });
    const subscription = harness.client.subscribe((notification) => notification.method === "event");
    const waiting = subscription.next();
    try {
      await harness.run("one", { sessionId: "subscription" });
      await expect(waiting).resolves.toMatchObject({ method: "event", params: { sessionId: "subscription" } });
      await harness.run("two", { sessionId: "subscription" });
      expect(subscription.tryNext()).toMatchObject({ method: "event" });
      await harness.run("three", { sessionId: "subscription" });
      await harness.close();
      expect(subscription.tryNext()).toBeUndefined();
      await expect(subscription.next()).rejects.toThrow("closed");
    } finally { await harness.close(); }
  });

  it("isolates a throwing notification filter and drains queued notifications after runtime death", async () => {
    const runtime = `
      const readline = require("node:readline"); const lines = readline.createInterface({ input: process.stdin });
      lines.on("line", (line) => { const request = JSON.parse(line);
        if (request.method === "initialize") process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n");
        else if (request.method === "prompt") { process.stdout.write(JSON.stringify({ method: "event", params: { requestId: request.id, sessionId: request.params.sessionId, event: { type: "text_delta", delta: "queued" } } }) + "\\n"); setTimeout(() => process.exit(7), 10); }
      });`;
    const harness = new SealHarness({ command: process.execPath, args: ["-e", runtime], requestTimeoutMs: 2_000 });
    const queued = harness.client.subscribe(); const broken = harness.client.subscribe(() => { throw new Error("filter failed"); });
    try {
      await expect(harness.run("die", { sessionId: "dying" })).rejects.toThrow("RPC exited");
      await expect(broken.next()).rejects.toThrow("filter failed");
      await expect(queued.next()).resolves.toMatchObject({ method: "event", params: { sessionId: "dying" } });
      await expect(queued.next()).rejects.toThrow("RPC exited");
    } finally { await harness.close(); }
  });

  it("scopes a notification subscription to a session and discovered descendants", async () => {
    const harness = new SealHarness({ command: process.execPath, args: ["-e", FAKE_RPC] });
    const subscription = harness.client.subscribeSessionTree("tree-root");
    try {
      await harness.run("tree", { sessionId: "tree-root" });
      const delivered = [subscription.tryNext(), subscription.tryNext(), subscription.tryNext()].filter(Boolean);
      expect(delivered).toEqual([
        expect.objectContaining({ method: "subagent.started" }),
        expect.objectContaining({ method: "event", params: expect.objectContaining({ sessionId: "tree-child" }) }),
        expect.objectContaining({ method: "event", params: expect.objectContaining({ sessionId: "tree-root" }) }),
      ]);
      expect(subscription.tryNext()).toBeUndefined();
    } finally { subscription.close(); await harness.close(); }
  });

  it("surfaces bounded runtime diagnostics on protocol errors", async () => {
    const harness = new SealHarness({
      command: process.execPath,
      args: ["-e", "process.stderr.write('fixture diagnostic'); process.exit(2)"],
      initializeTimeoutMs: 2_000,
    });
    await expect(harness.start()).rejects.toThrow(/RPC exited|fixture diagnostic/);
  });

  it("validates lifecycle timeout options", () => {
    expect(() => new SealHarness({ initializeTimeoutMs: 0 })).toThrow("initializeTimeoutMs");
    expect(() => new SealHarness({ requestTimeoutMs: -1 })).toThrow("requestTimeoutMs");
    expect(() => new SealHarness({ disposeEofGraceMs: 1.5 })).toThrow("disposeEofGraceMs");
  });

  it("shares concurrent close work and force-reaps a runtime that ignores shutdown and EOF", async () => {
    const runtime = `
      const readline = require("node:readline"); const lines = readline.createInterface({ input: process.stdin });
      const keepAlive = setInterval(() => {}, 1000); process.on("SIGTERM", () => {});
      lines.on("line", (line) => { const request = JSON.parse(line); if (request.method === "initialize") process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n"); });`;
    const harness = new SealHarness({ command: process.execPath, args: ["-e", runtime], shutdownTimeoutMs: 10, disposeEofGraceMs: 10, disposeGraceMs: 20 });
    await harness.start();
    const first = harness.client.close(); const second = harness.client.close();
    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it("reaps a failed initialization, creates a fresh client, and materializes the environment on retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seal-sdk-retry-"));
    const marker = join(directory, "attempt");
    const environmentName = `SEAL_SDK_LATE_${Date.now()}`;
    const runtime = `
      const fs = require("node:fs");
      const marker = ${JSON.stringify(marker)};
      if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.stderr.write("first initialization failed"); process.exit(9); }
      const readline = require("node:readline"); const lines = readline.createInterface({ input: process.stdin });
      lines.on("line", (line) => { const request = JSON.parse(line);
        if (request.method === "initialize") process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n");
        else if (request.method === "prompt") { const event = { type: "text_delta", delta: process.env[${JSON.stringify(environmentName)}] || "missing" }; process.stdout.write(JSON.stringify({ method: "event", params: { requestId: request.id, event } }) + "\\n"); process.stdout.write(JSON.stringify({ id: request.id, result: { sessionId: request.params.sessionId, runId: "retry", stopReason: "stop" } }) + "\\n"); }
        else if (request.method === "shutdown") { process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n"); lines.close(); }
      });`;
    const harness = new SealHarness({ command: process.execPath, args: ["-e", runtime], initializeTimeoutMs: 2_000 });
    try {
      const firstClient = harness.client;
      await expect(harness.start()).rejects.toThrow(/RPC exited|first initialization failed/);
      expect(harness.client).not.toBe(firstClient);
      process.env[environmentName] = "late-value";
      await expect(harness.run("retry", { sessionId: "retry-session" })).resolves.toMatchObject({ finalResponse: "late-value" });
    } finally {
      delete process.env[environmentName];
      await harness.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
