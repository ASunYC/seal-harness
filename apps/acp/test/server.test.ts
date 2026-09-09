import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type AnyMessage,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
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
import { AcpApprovalService, startAcpServer } from "../src/index.js";

describe("Seal Harness ACP server", () => {
  it("negotiates, streams prompts, lists, resumes, and closes sessions", async () => {
    const updates: SessionNotification[] = [];
    const streams = streamPair();
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "acp", model: "test", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond(request) {
          const prompt = request.messages.at(-1);
          yield { type: "text_delta", delta: `acp-ok:${prompt?.role ?? "none"}` };
          yield { type: "usage", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 12, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 1 } };
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, {}),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, { provider: "acp", model: "test", stream: streams.agent });
    const clientConnection = client({ name: "seal-acp-test" })
      .onNotification(methods.client.session.update, ({ params }) => { updates.push(params); })
      .connect(streams.client);
    try {
      const initialized = await clientConnection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "test", version: "1" },
      });
      expect(initialized.agentInfo?.name).toBe("seal-harness-acp");
      expect(initialized.agentCapabilities?.sessionCapabilities).toEqual({ list: {}, resume: {}, close: {} });
      expect(initialized.agentCapabilities?.mcpCapabilities).toEqual({ http: true });

      const cwd = resolve(process.cwd());
      const created = await clientConnection.agent.request(methods.agent.session.new, {
        cwd, mcpServers: [],
      });
      const completed = await clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      });
      expect(completed.stopReason).toBe("end_turn");
      expect(completed.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 12, cachedReadTokens: 2, cachedWriteTokens: 1, thoughtTokens: 1 });
      expect(updates).toContainEqual({
        sessionId: created.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "acp-ok:user" } },
      });
      await clientConnection.agent.request(methods.agent.session.close, { sessionId: created.sessionId });
      const listed = await clientConnection.agent.request(methods.agent.session.list, { cwd });
      expect(listed.sessions).toEqual([expect.objectContaining({ sessionId: created.sessionId, cwd })]);
      await clientConnection.agent.request(methods.agent.session.resume, {
        sessionId: created.sessionId, cwd, mcpServers: [],
      });
      await expect(clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "again" }],
      })).resolves.toEqual(expect.objectContaining({ stopReason: "end_turn" }));
    } finally {
      clientConnection.close();
      await server.close();
    }
  });

  it("validates workspace extensions and per-Session MCP declarations", async () => {
    const streams = streamPair();
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "acp", model: "test", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() { yield { type: "done", stopReason: "stop" }; },
      }),
      plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
      plugin(basicPolicyPlugin, {}), plugin(toolsCorePlugin, {}),
      plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, { provider: "acp", model: "test", stream: streams.agent });
    const clientConnection = client({ name: "seal-acp-test" }).connect(streams.client);
    try {
      await clientConnection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
      });
      await expect(clientConnection.agent.request(methods.agent.session.new, {
        cwd: "relative", mcpServers: [],
      })).rejects.toThrow(/absolute/);
      const cwd = resolve(process.cwd());
      await expect(clientConnection.agent.request(methods.agent.session.new, {
        cwd, additionalDirectories: [resolve(cwd, "..")], mcpServers: [],
      })).rejects.toThrow(/additionalDirectories/);
      await expect(clientConnection.agent.request(methods.agent.session.new, {
        cwd,
        mcpServers: [{ name: "fixture", command: "relative-command", args: [], env: [] }],
      })).rejects.toThrow(/command must be absolute/);
    } finally {
      clientConnection.close();
      await server.close();
    }
  });

  it("mounts stdio MCP tools only in their owning ACP Session", async () => {
    const streams = streamPair();
    const visibleTools: string[][] = [];
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "acp", model: "mcp", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond(request) {
          visibleTools.push(request.tools.map((tool) => tool.name));
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
      plugin(basicPolicyPlugin, {}), plugin(toolsCorePlugin, {}),
      plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, { provider: "acp", model: "mcp", stream: streams.agent });
    const clientConnection = client({ name: "seal-acp-mcp-test" }).connect(streams.client);
    try {
      await clientConnection.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      const cwd = resolve(process.cwd());
      const fixture = fileURLToPath(new URL("./fixtures/stdio-mcp-server.mjs", import.meta.url));
      const owned = await clientConnection.agent.request(methods.agent.session.new, {
        cwd, mcpServers: [{ name: "fixture server", command: process.execPath, args: [fixture], env: [] }],
      });
      await clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: owned.sessionId, prompt: [{ type: "text", text: "owned" }],
      });
      await clientConnection.agent.request(methods.agent.session.close, { sessionId: owned.sessionId });
      const plain = await clientConnection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
      await clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: plain.sessionId, prompt: [{ type: "text", text: "plain" }],
      });
      expect(visibleTools).toEqual([["mcp__fixture_server__echo"], []]);
    } finally {
      clientConnection.close();
      await server.close();
    }
  });

  it("lists active and persisted Sessions with opaque keyset pagination", async () => {
    const streams = streamPair();
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "acp", model: "list", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() { yield { type: "done", stopReason: "stop" }; },
      }),
      plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
      plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, {
      provider: "acp", model: "list", stream: streams.agent, sessionListPageSize: 2,
    });
    const clientConnection = client({ name: "seal-acp-list-test" }).connect(streams.client);
    try {
      await clientConnection.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      const cwd = resolve(process.cwd());
      const created = await Promise.all([0, 1, 2].map(() => clientConnection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] })));
      const first = await clientConnection.agent.request(methods.agent.session.list, { cwd });
      expect(first.sessions).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      if (typeof first.nextCursor !== "string") throw new Error("first page did not return a cursor");
      const second = await clientConnection.agent.request(methods.agent.session.list, { cwd, cursor: first.nextCursor });
      expect(second.sessions).toHaveLength(1);
      expect(second.nextCursor).toBeUndefined();
      expect(new Set([...first.sessions, ...second.sessions].map((entry) => entry.sessionId))).toEqual(new Set(created.map((entry) => entry.sessionId)));
      await expect(clientConnection.agent.request(methods.agent.session.list, { cwd, cursor: "not-canonical" })).rejects.toThrow(/cursor is invalid/);
    } finally {
      clientConnection.close();
      await server.close();
    }
  });

  it("switches and persists per-Session model and reasoning configuration", async () => {
    const streams = streamPair();
    const requests: Array<{ provider: string; model: string; reasoning?: string }> = [];
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [
          { provider: "alpha", model: "plain", contextWindow: 1_000, maxOutputTokens: 100 },
          { provider: "beta", model: "thinking", contextWindow: 2_000, maxOutputTokens: 200, supportsReasoning: true },
        ],
        async *respond(request) {
          requests.push({ ...request.model, ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }) });
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
      plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, { provider: "alpha", model: "plain", stream: streams.agent });
    const clientConnection = client({ name: "seal-acp-config-test" }).connect(streams.client);
    try {
      await clientConnection.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      const cwd = resolve(process.cwd());
      const created = await clientConnection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
      expect(created.configOptions?.map((option) => option.id)).toEqual(["model"]);
      const selected = await clientConnection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: created.sessionId, configId: "model", value: JSON.stringify(["beta", "thinking"]),
      });
      expect(selected.configOptions.map((option) => option.id)).toEqual(["model", "reasoning_effort"]);
      await clientConnection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: created.sessionId, configId: "reasoning_effort", value: "high",
      });
      await clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId, prompt: [{ type: "text", text: "configured" }],
      });
      await clientConnection.agent.request(methods.agent.session.close, { sessionId: created.sessionId });
      const resumed = await clientConnection.agent.request(methods.agent.session.resume, {
        sessionId: created.sessionId, cwd, mcpServers: [],
      });
      expect(resumed.configOptions?.find((option) => option.id === "model")?.currentValue).toBe(JSON.stringify(["beta", "thinking"]));
      expect(resumed.configOptions?.find((option) => option.id === "reasoning_effort")?.currentValue).toBe("high");
      await clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId, prompt: [{ type: "text", text: "resumed" }],
      });
      expect(requests).toEqual([
        { provider: "beta", model: "thinking", reasoning: "high" },
        { provider: "beta", model: "thinking", reasoning: "high" },
      ]);
      await expect(clientConnection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: created.sessionId, configId: "model", value: JSON.stringify(["missing", "model"]),
      })).rejects.toThrow(/unknown model option/);
      await clientConnection.agent.request(methods.agent.session.close, { sessionId: created.sessionId });
      const concurrent = await Promise.allSettled([0, 1].map(() => clientConnection.agent.request(methods.agent.session.resume, {
        sessionId: created.sessionId, cwd, mcpServers: [],
      })));
      expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(concurrent.find((result) => result.status === "rejected")?.reason).toEqual(expect.objectContaining({ message: expect.stringMatching(/already active/) }));
    } finally {
      clientConnection.close();
      await server.close();
    }
  });

  it("routes dangerous tool permission through the ACP client", async () => {
    const streams = streamPair();
    const approval = new AcpApprovalService();
    const approvalPlugin = definePlugin<undefined, SealHarnessEvents>({
      name: "acp-test-approval",
      provides: [approvalServiceToken],
      setup(context) { context.provide(approvalServiceToken, approval); },
    });
    let step = 0;
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "acp", model: "tools", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() {
          step += 1;
          if (step === 1) {
            yield {
              type: "tool_call",
              call: {
                type: "tool_call", id: toolCallId("acp-shell"), name: "shell",
                arguments: { command: `\"${process.execPath}\" -e \"process.stdout.write('allowed')\"` },
              },
            };
            yield { type: "done", stopReason: "tool_call" };
          } else {
            yield { type: "text_delta", delta: "permission-ok" };
            yield { type: "done", stopReason: "stop" };
          }
        },
      }),
      plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
      plugin(basicPolicyPlugin, { mode: "workspace-write" }),
      plugin(approvalPlugin, undefined), plugin(toolsCorePlugin, {}),
      plugin(workspaceToolsPlugin, {}), plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, {
      provider: "acp", model: "tools", stream: streams.agent, approvalService: approval,
    });
    const permissions: string[] = [];
    const updates: SessionNotification[] = [];
    const clientConnection = client({ name: "seal-acp-permission-test" })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        permissions.push(params.toolCall.toolCallId);
        return { outcome: { outcome: "selected", optionId: "allow-once" } };
      })
      .onNotification(methods.client.session.update, ({ params }) => { updates.push(params); })
      .connect(streams.client);
    try {
      await clientConnection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
      });
      const created = await clientConnection.agent.request(methods.agent.session.new, {
        cwd: resolve(process.cwd()), mcpServers: [],
      });
      await expect(clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId, prompt: [{ type: "text", text: "run" }],
      })).resolves.toEqual(expect.objectContaining({ stopReason: "end_turn" }));
      expect(permissions).toEqual(["acp-shell"]);
      expect(updates).toEqual(expect.arrayContaining([
        expect.objectContaining({ update: expect.objectContaining({ sessionUpdate: "tool_call", toolCallId: "acp-shell" }) }),
        expect.objectContaining({ update: expect.objectContaining({ sessionUpdate: "tool_call_update", status: "completed" }) }),
        expect.objectContaining({ update: expect.objectContaining({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "permission-ok" } }) }),
      ]));
    } finally {
      clientConnection.close();
      await server.close();
    }
  });

  it("cancels an in-flight prompt through session/cancel", async () => {
    const streams = streamPair();
    let markStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise; });
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "acp", model: "cancel", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond(request) {
          markStarted();
          await new Promise<void>((_resolvePromise, reject) => {
            request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
          });
        },
      }),
      plugin(memorySessionPlugin, {}), plugin(contextCorePlugin, {}),
      plugin(piRuntimePlugin, {}), plugin(agentCorePlugin, {}),
    ]);
    const server = await startAcpServer(profile, { provider: "acp", model: "cancel", stream: streams.agent });
    const clientConnection = client({ name: "seal-acp-cancel-test" }).connect(streams.client);
    try {
      await clientConnection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
      });
      const created = await clientConnection.agent.request(methods.agent.session.new, {
        cwd: resolve(process.cwd()), mcpServers: [],
      });
      const result = clientConnection.agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId, prompt: [{ type: "text", text: "wait" }],
      });
      await started;
      await clientConnection.agent.notify(methods.agent.session.cancel, { sessionId: created.sessionId });
      await expect(result).resolves.toEqual(expect.objectContaining({ stopReason: "cancelled" }));
    } finally {
      clientConnection.close();
      await server.close();
    }
  });
});

function streamPair(): { agent: Stream; client: Stream } {
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>();
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>();
  return {
    agent: { writable: agentToClient.writable, readable: clientToAgent.readable },
    client: { writable: clientToAgent.writable, readable: agentToClient.readable },
  };
}
