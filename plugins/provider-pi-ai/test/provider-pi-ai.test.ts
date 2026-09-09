import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  createAssistantMessageEventStream,
  createModels,
  type AssistantMessage,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { getBuiltinProviders, builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { modelServiceToken, settingsServiceToken, userMessage, type JsonObject, type SettingsDescriptor, type SettingsRegistration, type SettingsScope, type SettingsService } from "@seal-harness/core";
import { definePlugin, Kernel, plugin } from "@seal-harness/kernel";
import { PiAiModelService, parseModelCatalog, piAiProviderPlugin } from "../src/index.js";

describe("PiAiModelService", () => {
  it("registers the complete native PI catalog by default without narrowing protocols or auth", async () => {
    const kernel = new Kernel<import("@seal-harness/core").SealHarnessEvents>();
    await kernel.start([plugin(piAiProviderPlugin, {})]);
    try {
      const service = kernel.use(modelServiceToken) as PiAiModelService;
      expect(service.models.getProviders().map((entry) => entry.id).sort()).toEqual([...getBuiltinProviders(), "radius"].sort());
      for (const expected of builtinProviders()) {
        const actual = service.models.getProviders().find((entry) => entry.id === expected.id)!;
        expect(Object.keys(actual.auth)).toEqual(Object.keys(expected.auth));
        expect(actual.getModels().map((model) => model.api)).toEqual(expected.getModels().map((model) => model.api));
      }
    } finally { await kernel.stop(); }
  });
  it("normalizes OpenAI and keyed model catalogs", () => {
    expect(parseModelCatalog({ data: [
      { id: "alpha", name: "Alpha", context_window: 64_000, max_output_tokens: 4_096 },
      { id: "alpha" },
    ] })).toEqual([{ id: "alpha", name: "Alpha", contextWindow: 64_000, maxOutputTokens: 4_096 }]);
    expect(parseModelCatalog({ models: {
      beta: { display_name: "Beta", limit: { context: 32_000, output: 2_000 }, reasoning: true },
    } })).toEqual([{
      id: "beta", name: "Beta", contextWindow: 32_000, maxOutputTokens: 2_000, reasoning: true,
    }]);
  });

  it("rejects malformed custom provider catalogs at the configuration boundary", () => {
    expect(() => new PiAiModelService(createModels()).addCustomProvider({ id: "bad", baseUrl: "https://example.com/v1", models: [{ id: "dup" }, { id: "dup" }] })).toThrow("model ids must be unique");
    expect(() => new PiAiModelService(createModels()).addCustomProvider({ id: "bad", baseUrl: "https://example.com/v1", models: [{ id: "ok" }], headers: { authorization: 42 } as any })).toThrow("headers must contain string values");
  });

  it("discovers a custom provider and immediately streams through it", async () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url ?? "", authorization: request.headers.authorization });
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "remote-chat", context_window: 16_000 }] }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({
          id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "remote-chat",
          choices: [{ index: 0, delta: { role: "assistant", content: "remote-ok" }, finish_reason: null }],
        })}\n\n`);
        response.write(`data: ${JSON.stringify({
          id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "remote-chat",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing test address");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    try {
      const service = new PiAiModelService(createModels(), {
        async resolve() { return "runtime-secret"; },
      });
      await expect(service.discoverAndAdd({ id: "remote", baseUrl }, { apiKey: "discovery-secret" }))
        .resolves.toEqual([expect.objectContaining({ provider: "remote", model: "remote-chat" })]);
      const events = [];
      for await (const event of service.stream({
        model: { provider: "remote", model: "remote-chat" },
        systemPrompt: "test",
        messages: [userMessage("hello")],
        tools: [],
        signal: new AbortController().signal,
      })) events.push(event);
      expect(events).toContainEqual({ type: "text_delta", delta: "remote-ok" });
      expect(events).toContainEqual(expect.objectContaining({ type: "done", stopReason: "stop" }));
      expect(requests).toEqual([
        { url: "/v1/models", authorization: "Bearer discovery-secret" },
        { url: "/v1/chat/completions", authorization: "Bearer runtime-secret" },
      ]);
    } finally {
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    }
  });

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

  it("explicitly rejects stop sequences instead of silently ignoring them", async () => {
    const service = new PiAiModelService(createModels());
    const next = service.stream({
      model: { provider: "missing", model: "missing" },
      systemPrompt: "",
      messages: [],
      tools: [],
      stop: ["END"],
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]().next();
    await expect(next).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
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
    expect(events).toContainEqual({
      type: "usage",
      usage: expect.objectContaining({ inputTokens: 1, outputTokens: 1, reasoningTokens: 1, routes: [{ provider: "capture", model: "capture-model" }] }),
    });
  });

  it("atomically replaces the live provider catalog from Settings updates", async () => {
    let scope!: SettingsScope; const updates: Array<{ revision: number; providers: readonly string[] }> = [];
    const settingsPlugin = definePlugin({ name: "test-settings", provides: [settingsServiceToken], setup(context) { context.provide(settingsServiceToken, { writable: true, register(namespace: string, options: SettingsRegistration = {}) { let revision = 0; let value = options.validate?.(structuredClone(options.base ?? {})) ?? structuredClone(options.base ?? {}); const listeners = new Set<any>(); const describe = (): SettingsDescriptor => ({ namespace, value, base: options.base ?? {}, revision, applies: options.applies ?? "live" }); scope = { get: describe, async update(patch) { const previous = describe(); value = options.validate?.({ ...value, ...patch }) ?? { ...value, ...patch }; revision += 1; const next = describe(); for (const listener of listeners) await listener(next, previous); return next; }, async replace(nextValue) { const previous = describe(); value = options.validate?.(nextValue) ?? nextValue; revision += 1; const next = describe(); for (const listener of listeners) await listener(next, previous); return next; }, async mutate() { throw new Error("not used"); }, watch(listener) { listeners.add(listener); return () => listeners.delete(listener); }, dispose() { listeners.clear(); } }; return scope; }, scope() { return scope; }, describe() { return [scope.get()]; } } as unknown as SettingsService); } });
    const observer = definePlugin<any, import("@seal-harness/core").SealHarnessEvents>({ name: "model-observer", setup(context) { context.on("models.updated", (event) => { updates.push(event); }); } });
    const kernel = new Kernel<import("@seal-harness/core").SealHarnessEvents>(); await kernel.start([plugin(settingsPlugin, undefined), plugin(piAiProviderPlugin, { providers: ["deepseek"] }), plugin(observer, undefined)]);
    expect(new Set((await kernel.use(modelServiceToken).list()).map((model) => model.provider))).toEqual(new Set(["deepseek"]));
    await scope.update({ providers: ["openai"] } as JsonObject);
    expect(new Set((await kernel.use(modelServiceToken).list()).map((model) => model.provider))).toEqual(new Set(["openai"]));
    expect(updates).toEqual([{ revision: 1, providers: ["openai"] }]);
    await expect(scope.update({ providers: ["not-real"] } as JsonObject)).rejects.toThrow("known provider ids");
    expect(new Set((await kernel.use(modelServiceToken).list()).map((model) => model.provider))).toEqual(new Set(["openai"]));
    await kernel.stop();
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
      reasoning: 1,
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
