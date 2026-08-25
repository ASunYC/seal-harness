import { describe, expect, it } from "vitest";
import { agentCorePlugin } from "@piharness/agent-core";
import { contextCorePlugin } from "@piharness/context-core";
import { agentServiceToken, text } from "@piharness/core";
import { defineProfile, startProfile } from "@piharness/host";
import { plugin } from "@piharness/kernel";
import { memorySessionPlugin } from "@piharness/session-memory";
import { scriptedRuntimePlugin } from "../src/index.js";

describe("scripted runtime", () => {
  it("runs a complete Agent profile without ModelService or Pi", async () => {
    const assistant = { role: "assistant" as const, content: [text("runtime-only")] };
    const kernel = await startProfile(defineProfile([
      plugin(memorySessionPlugin, {}),
      plugin(contextCorePlugin, { systemPrompt: "test" }),
      plugin(scriptedRuntimePlugin, {
        execute(request) {
          return {
            events: [
              { type: "run_start", runId: request.runId },
              { type: "turn_start", index: 0 },
              { type: "assistant_message", message: assistant },
              { type: "turn_end", index: 0 },
              { type: "run_end", stopReason: "stop" },
            ],
            result: {
              messages: [...request.messages, assistant],
              stopReason: "stop",
            },
          };
        },
      }),
      plugin(agentCorePlugin, {}),
    ]));
    try {
      const execution = await kernel.use(agentServiceToken).prompt({
        cwd: process.cwd(),
        model: { provider: "none", model: "none" },
        prompt: [text("hello")],
      });
      const events = [];
      for await (const event of execution) events.push(event);
      const result = await execution.result;
      expect(events.some((event) => event.type === "assistant_message")).toBe(true);
      expect(result.runtime.messages.at(-1)).toEqual(assistant);
      expect(result.session.events.at(-1)?.event).toMatchObject({
        type: "run.completed",
        payload: { outcome: "completed" },
      });
    } finally {
      await kernel.stop();
    }
  });
});
