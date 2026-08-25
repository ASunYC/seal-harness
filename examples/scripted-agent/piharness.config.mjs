import { agentCorePlugin } from "@piharness/agent-core";
import { contextCorePlugin } from "@piharness/context-core";
import { fileContextPlugin } from "@piharness/context-files";
import { defineProfile } from "@piharness/host";
import { plugin } from "@piharness/kernel";
import { scriptedModelPlugin } from "@piharness/model-scripted";
import { piRuntimePlugin } from "@piharness/runtime-pi";
import { memorySessionPlugin } from "@piharness/session-memory";

export default defineProfile([
  plugin(scriptedModelPlugin, {
    models: [{
      provider: "scripted",
      model: "demo",
      displayName: "Offline Demo",
      contextWindow: 32000,
      maxOutputTokens: 4096,
    }],
    async *respond(request) {
      const last = request.messages.at(-1);
      const text = last?.role === "user"
        ? last.content.filter((block) => block.type === "text").map((block) => block.text).join(" ")
        : "";
      yield { type: "text_delta", delta: `Offline Pi Agent received: ${text}` };
      yield { type: "done", stopReason: "stop" };
    },
  }),
  plugin(memorySessionPlugin, {}),
  plugin(contextCorePlugin, { systemPrompt: "You are an offline PiHarness demo." }),
  plugin(fileContextPlugin, {}),
  plugin(piRuntimePlugin, {}),
  plugin(agentCorePlugin, {}),
]);
