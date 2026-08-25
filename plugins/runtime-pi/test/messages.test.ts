import { describe, expect, it } from "vitest";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { fromPiAssistantMessage, toPiMessage } from "../src/index.js";

const MODEL: Model<any> = {
  id: "model",
  name: "Model",
  api: "test-api",
  provider: "test-provider",
  baseUrl: "test://",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000,
  maxTokens: 100,
};

describe("Pi message conversion", () => {
  it("preserves opaque reasoning and tool signatures across a round trip", () => {
    const source: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "private reasoning",
          thinkingSignature: "signature-1",
          redacted: false,
        },
        {
          type: "toolCall",
          id: "call-1",
          name: "read",
          arguments: { path: "README.md" },
          thoughtSignature: "signature-2",
          namespace: "workspace",
        },
      ],
      api: "test-api",
      provider: "test-provider",
      model: "model",
      responseId: "response-1",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 123,
    };

    const core = fromPiAssistantMessage(source);
    const restored = toPiMessage(core, MODEL);

    expect(restored).toMatchObject({
      role: "assistant",
      api: "test-api",
      provider: "test-provider",
      model: "model",
      stopReason: "toolUse",
      timestamp: 123,
      content: [
        {
          type: "thinking",
          thinking: "private reasoning",
          thinkingSignature: "signature-1",
          redacted: false,
        },
        {
          type: "toolCall",
          id: "call-1",
          thoughtSignature: "signature-2",
          namespace: "workspace",
        },
      ],
    });
  });
});
