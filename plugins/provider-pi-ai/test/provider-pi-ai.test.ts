import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  createModels,
  type AssistantMessage,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { userMessage } from "@seal-harness/core";
import { PiAiModelService } from "../src/index.js";

describe("PiAiModelService", () => {
  it("exposes only providers registered in its Pi Models collection", async () => {
    const models = createModels();
    models.setProvider(deepseekProvider());
    const service = new PiAiModelService(models);

    const listed = await service.list();
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed.map((model) => model.provider))).toEqual(new Set(["deepseek"]));
    const first = listed[0];
    expect(first).toBeDefined();
    await expect(service.get({ provider: "deepseek", model: first?.model ?? "" }))
      .resolves.toEqual(first);
    await expect(service.get({ provider: "openai", model: "missing" }))
      .resolves.toBeUndefined();
  });

  it("uses a resolved credential without exposing it in normalized events", async () => {
    const secret = "test-secret-must-not-leak";
    const model: Model<any> = {
      id: "capture-model",
      name: "Capture Model",
      api: "capture-api",
      provider: "capture",
      baseUrl: "capture://",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000,
      maxTokens: 100,
    };
    let capturedApiKey: string | undefined;
    let credentialResolved = false;
    const provider: Provider = {
      id: "capture",
      name: "Capture",
      auth: {
        apiKey: {
          name: "Capture key",
          async resolve({ credential }) {
            return credential?.key === undefined
              ? undefined
              : { auth: { apiKey: credential.key }, source: "test credential" };
          },
        },
      },
      getModels: () => [model],
      stream(_model, _context, options) {
        return responseStream(model, options?.apiKey, (value) => { capturedApiKey = value; });
      },
      streamSimple(_model, _context, options) {
        return responseStream(model, options?.apiKey, (value) => { capturedApiKey = value; });
      },
    };
    const models = createModels();
    models.setProvider(provider);
    const service = new PiAiModelService(models, {
      async resolve() {
        credentialResolved = true;
        return secret;
      },
    });

    const events = [];
    for await (const event of service.stream({
      model: { provider: "capture", model: "capture-model" },
      systemPrompt: "test",
      messages: [userMessage("hello")],
      tools: [],
      signal: new AbortController().signal,
    })) events.push(event);

    expect(credentialResolved).toBe(true);
    // The secret reaches only the provider request boundary.
    expect(capturedApiKey).toBe(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events).toContainEqual({ type: "text_delta", delta: "ok" });
  });
});

function responseStream(
  model: Model<any>,
  apiKey: string | undefined,
  capture: (value: string | undefined) => void,
) {
  capture(apiKey);
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "ok", partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}
