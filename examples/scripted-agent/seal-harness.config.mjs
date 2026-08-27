import { agentCorePlugin } from "@seal-harness/agent-core";
import { contextCorePlugin } from "@seal-harness/context-core";
import { fileContextPlugin } from "@seal-harness/context-files";
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";
import { scriptedModelPlugin } from "@seal-harness/model-scripted";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { memorySessionPlugin } from "@seal-harness/session-memory";

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
  plugin(contextCorePlugin, { systemPrompt: "You are an offline Seal Harness demo." }),
  plugin(fileContextPlugin, {}),
  plugin(piRuntimePlugin, {}),
  plugin(agentCorePlugin, {}),
]);
