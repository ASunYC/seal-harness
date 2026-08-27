import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentCorePlugin } from "@seal-harness/agent-core";
import { contextCorePlugin } from "@seal-harness/context-core";
import { approvalServiceToken, toolCallId, type SealHarnessEvents } from "@seal-harness/core";
import { defineProfile } from "@seal-harness/host";
import { definePlugin, plugin } from "@seal-harness/kernel";
import { scriptedModelPlugin } from "@seal-harness/model-scripted";
import { basicPolicyPlugin } from "@seal-harness/policy-basic";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { memorySessionPlugin } from "@seal-harness/session-memory";
import { toolsCorePlugin } from "@seal-harness/tools-core";
import { workspaceToolsPlugin } from "@seal-harness/workspace-tools";
import { WebApprovalService } from "../src/approval.js";
import { startWebServer, type RunningWebServer } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

describe("Seal Harness Web server", () => {
  it("serves the UI and streams an Agent run into a persisted session", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() {
          yield { type: "text_delta", delta: "web-ok" };
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "web test" }),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]);
    const running = await startWebServer({ cwd, port: 0, profile });
    cleanup.push(() => running.close());

    const index = await fetch(running.url);
    expect(index.status).toBe(200);
    await expect(index.text()).resolves.toContain("Seal Harness");
    const app = await fetch(`${running.url}/app.js`);
    await expect(app.text()).resolves.toContain("amazon-bedrock");
    const mascot = await fetch(`${running.url}/assets/seal-harness-mascot.png`);
    expect(mascot.status).toBe(200);
    expect(mascot.headers.get("content-type")).toBe("image/png");
    expect((await mascot.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
    const models = await fetchJson(`${running.url}/api/models`);
    expect(models).toEqual([expect.objectContaining({ provider: "scripted", model: "web" })]);

    const response = await fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, provider: "scripted", model: "web", prompt: "hello" }),
    });
    expect(response.status).toBe(200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toContainEqual(expect.objectContaining({
      type: "event", event: { type: "text_delta", delta: "web-ok" },
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", stopReason: "stop" }));
    const started = events.find((item) => item.type === "started");

    const sessions = await fetchJson(`${running.url}/api/sessions`) as Array<{ id: string }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(started.sessionId);
    const session = await fetchJson(`${running.url}/api/sessions/${encodeURIComponent(started.sessionId)}`) as any;
    expect(session.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "assistant" }),
    ]));
  });

  it("rejects cross-origin state-changing requests", async () => {
    const running = await scriptedServer();
    cleanup.push(() => running.close());
    const response = await fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
  });

  it("reports credential readiness without returning secrets", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-credentials-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const credentialEnvironment: Record<string, string | undefined> = {};
    const running = await startWebServer({
      cwd, port: 0, providers: ["deepseek"], credentialEnvironment,
    });
    cleanup.push(() => running.close());

    const before = await fetchJson(`${running.url}/api/credentials`);
    expect(before).toEqual({ managed: true, configuredProviders: [] });

    const secret = "sk-test-readiness-secret";
    const saved = await fetch(`${running.url}/api/credentials/deepseek`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: secret }),
    });
    expect(saved.status).toBe(200);
    const afterResponse = await fetch(`${running.url}/api/credentials`);
    const afterText = await afterResponse.text();
    expect(afterText).not.toContain(secret);
    expect(JSON.parse(afterText)).toEqual({ managed: true, configuredProviders: ["deepseek"] });
  });

  it("pauses a dangerous tool until the Web approval endpoint allows it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-approval-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const approvals = new WebApprovalService();
    const approvalPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "test-web-approval",
      provides: [approvalServiceToken],
      setup(context) { context.provide(approvalServiceToken, approvals); },
    });
    let step = 0;
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() {
          step += 1;
          if (step === 1) {
            yield {
              type: "tool_call",
              call: {
                type: "tool_call",
                id: toolCallId("approval-shell"),
                name: "shell",
                arguments: { command: `\"${process.execPath}\" -e \"process.stdout.write('approved')\"` },
              },
            };
            yield { type: "done", stopReason: "tool_call" };
          } else {
            yield { type: "text_delta", delta: "approved-ok" };
            yield { type: "done", stopReason: "stop" };
          }
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "approval test" }),
      plugin(basicPolicyPlugin, { mode: "workspace-write" }),
      plugin(approvalPlugin, undefined),
      plugin(toolsCorePlugin, {}),
      plugin(workspaceToolsPlugin, {}),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]);
    const running = await startWebServer({ cwd, port: 0, profile, approvalService: approvals });
    cleanup.push(() => running.close());

    const run = fetch(`${running.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, provider: "scripted", model: "web", prompt: "run" }),
    });
    const pending = await waitForApproval(running.url);
    const decision = await fetch(`${running.url}/api/approvals/${encodeURIComponent(pending.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    expect(decision.status).toBe(200);
    const output = await (await run).text();
    expect(output).toContain("approved-ok");
    expect(output).toContain('"type":"tool_result"');
  });
});

async function scriptedServer(): Promise<RunningWebServer> {
  const cwd = await mkdtemp(join(tmpdir(), "seal-harness-web-origin-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  return startWebServer({
    cwd,
    port: 0,
    profile: defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "web", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() { yield { type: "done", stopReason: "stop" }; },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "test" }),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]),
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function waitForApproval(url: string): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const values = await fetchJson(`${url}/api/approvals`) as Array<{ id: string }>;
    if (values[0] !== undefined) return values[0];
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Approval did not become pending");
}
