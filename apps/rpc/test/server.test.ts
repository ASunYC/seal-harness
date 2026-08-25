import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { agentCorePlugin } from "@piharness/agent-core";
import { contextCorePlugin } from "@piharness/context-core";
import { defineProfile } from "@piharness/host";
import { plugin } from "@piharness/kernel";
import { scriptedModelPlugin } from "@piharness/model-scripted";
import { piRuntimePlugin } from "@piharness/runtime-pi";
import { memorySessionPlugin } from "@piharness/session-memory";
import { runRpcServer } from "../src/index.js";

describe("RPC server", () => {
  it("streams prompt events and returns strict JSONL responses", async () => {
    const profile = defineProfile([
      plugin(scriptedModelPlugin, {
        models: [{ provider: "scripted", model: "test", contextWindow: 1_000, maxOutputTokens: 100 }],
        async *respond() {
          yield { type: "text_delta", delta: "rpc-ok" };
          yield { type: "done", stopReason: "stop" };
        },
      }),
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "test" }),
      plugin(piRuntimePlugin, {}),
      plugin(agentCorePlugin, {}),
    ]);
    const input = new PassThrough();
    let output = "";
    const running = runRpcServer(profile, {
      input,
      output: { write(value) { output += value; } },
    });
    input.end([
      JSON.stringify({ id: 1, method: "listModels" }),
      JSON.stringify({
        id: 2,
        method: "prompt",
        params: {
          cwd: process.cwd(), provider: "scripted", model: "test", prompt: "hello",
        },
      }),
      JSON.stringify({ id: 3, method: "listSessions" }),
      JSON.stringify({ id: 4, method: "shutdown" }),
    ].join("\n") + "\n");
    await running;

    const messages = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(messages).toContainEqual(expect.objectContaining({ id: 1, result: [expect.any(Object)] }));
    expect(messages).toContainEqual(expect.objectContaining({
      method: "event",
      params: expect.objectContaining({ requestId: 2, event: { type: "text_delta", delta: "rpc-ok" } }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      id: 2,
      result: expect.objectContaining({ stopReason: "stop" }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({ id: 4, result: { stopped: true } }));
  });
});
