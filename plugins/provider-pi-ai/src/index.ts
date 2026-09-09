import {
  createProvider,
  createModels,
  envApiKeyAuth,
  type AssistantMessageEvent,
  type Model,
  type Models,
  type MutableModels,
  type Provider,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  credentialServiceToken,
  modelServiceToken,
  settingsServiceToken,
  toolCallId,
  type CredentialService,
  type ModelInfo,
  type ModelRequest,
  type ModelService,
  type ModelStopReason,
  type ModelStreamEvent,
  type ModelUsage,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
import { fromPiAssistantMessage, toPiLlmMessages } from "@seal-harness/runtime-pi";
import { Type } from "typebox";
import { piCredentialStore } from "./credentials.js";
import { PiLoginFlows } from "./login.js";
import { builtinProviders as createBuiltinProviders, getBuiltinProviders, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all";

export type PiAiBuiltinProvider = BuiltinProvider | "radius";
export const piAiBuiltinProviders: readonly PiAiBuiltinProvider[] = [...getBuiltinProviders(), "radius"];

export interface PiAiProviderConfig {
  readonly providers?: readonly PiAiBuiltinProvider[];
  readonly customProviders?: readonly PiAiCustomProvider[];
  readonly refreshOnStart?: boolean;
}

export type PiAiProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages";

export interface PiAiCustomModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly input?: readonly ("text" | "image")[];
}

export interface PiAiCustomProvider {
  readonly id: string;
  readonly name?: string;
  readonly baseUrl: string;
  readonly api?: PiAiProviderApi;
  readonly models: readonly PiAiCustomModel[];
  readonly headers?: Readonly<Record<string, string>>;
}

export interface DiscoverModelsRequest {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}

export class PiAiModelService implements ModelService {
  readonly logins = new PiLoginFlows(() => this.models);
  #revision = 0;
  constructor(
    public models: MutableModels,
    readonly credentials?: CredentialService,
  ) {}

  get catalogRevision(): number { return this.#revision; }

  replaceModels(models: MutableModels): void { this.models = models; this.#revision += 1; }

  addCustomProvider(config: PiAiCustomProvider): void {
    this.models.setProvider(createCustomProvider(config));
    this.#revision += 1;
  }

  async discoverAndAdd(
    config: Omit<PiAiCustomProvider, "models">,
    request: Omit<DiscoverModelsRequest, "baseUrl"> = {},
  ): Promise<readonly ModelInfo[]> {
    const discovered = await discoverProviderModels({ ...request, baseUrl: config.baseUrl });
    this.addCustomProvider({ ...config, models: discovered });
    return discovered.map((model) => toModelInfo(toPiModel(config, model)));
  }

  async list(): Promise<readonly ModelInfo[]> {
    return this.models.getModels().map(toModelInfo);
  }

  async get(ref: { provider: string; model: string }): Promise<ModelInfo | undefined> {
    const model = this.models.getModel(ref.provider, ref.model);
    return model === undefined ? undefined : toModelInfo(model);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    if (request.stop !== undefined) {
      throw Object.assign(new Error("provider-pi-ai does not support ModelRequest.stop"), { code: "UNSUPPORTED_OPTION" });
    }
    const models = this.models;
    const model = models.getModel(request.model.provider, request.model.model);
    if (model === undefined) {
      yield { type: "done", stopReason: "error" };
      return;
    }

    const storedAccount = await this.credentials?.readRecord?.("pi-auth/" + request.model.provider);
    const apiKey = storedAccount === undefined ? await this.credentials?.resolve({
      provider: request.model.provider,
      name: "apiKey",
      signal: request.signal,
    }) : undefined;
    const options: SimpleStreamOptions = {
      signal: request.signal,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { maxTokens: request.maxOutputTokens }),
      ...(request.reasoning === undefined || request.reasoning === "off"
        ? {}
        : { reasoning: request.reasoning }),
    };
    const stream = models.streamSimple(model, {
      systemPrompt: request.systemPrompt,
      messages: toPiLlmMessages(request.messages, model),
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: Type.Unsafe({ ...tool.inputSchema }),
      })),
    }, options);

    for await (const event of stream) {
      const converted = fromPiEvent(event, { provider: model.provider, model: model.id });
      for (const item of converted) yield item;
    }
  }
}

export const piAiProviderPlugin = definePlugin<PiAiProviderConfig, SealHarnessEvents>({
  name: "provider-pi-ai",
  provides: [modelServiceToken],
  optional: [credentialServiceToken, settingsServiceToken],
  async setup(context, config) {
    const settings = context.has(settingsServiceToken) ? context.use(settingsServiceToken) : undefined;
    const scope = settings?.register("provider-pi-ai", {
      base: providerSettings(config), applies: "live", schema: providerSettingsSchema,
      validate: validateProviderSettings,
      secretPaths: (value) => Array.isArray(value.customProviders) ? value.customProviders.flatMap((provider, index) => isRecord(provider) && isRecord(provider.headers) ? [["customProviders", String(index), "headers"]] : []) : [],
    });
    if (scope !== undefined) context.effect(() => scope.dispose());
    const initial = (scope?.get().value ?? validateProviderSettings(providerSettings(config))) as unknown as PiAiProviderConfig;
    const credentials = context.has(credentialServiceToken)
      ? context.use(credentialServiceToken)
      : undefined;
    const models = await createConfiguredModels(initial, credentials);
    const service = new PiAiModelService(models, credentials);
    context.effect(() => service.logins.close());
    context.provide(modelServiceToken, service);
    if (scope !== undefined) context.effect(scope.watch(async (next) => {
      const replacement = await createConfiguredModels(next.value as unknown as PiAiProviderConfig, credentials);
      service.replaceModels(replacement);
      await context.emit("models.updated", { revision: service.catalogRevision, providers: replacement.getProviders().map((provider) => provider.id) });
    }));
  },
});

const builtinProviders = new Set<PiAiBuiltinProvider>(piAiBuiltinProviders);
const providerSettingsSchema = { type: "object", properties: { providers: { type: "array", title: "Built-in providers", items: { type: "string", enum: [...builtinProviders] } }, customProviders: { type: "array", title: "Custom providers", items: { type: "object" } }, refreshOnStart: { type: "boolean", title: "Refresh model catalogs" } } } as const;
function providerSettings(config: PiAiProviderConfig): import("@seal-harness/core").JsonObject { return structuredClone({ providers: config.providers ?? piAiBuiltinProviders, customProviders: config.customProviders ?? [], refreshOnStart: config.refreshOnStart ?? false }) as unknown as import("@seal-harness/core").JsonObject; }
function validateProviderSettings(value: import("@seal-harness/core").JsonObject): import("@seal-harness/core").JsonObject {
  if (!Array.isArray(value.providers) || value.providers.some((provider) => typeof provider !== "string" || !builtinProviders.has(provider as PiAiBuiltinProvider))) throw new TypeError("provider-pi-ai providers must contain known provider ids");
  if (new Set(value.providers).size !== value.providers.length) throw new TypeError("provider-pi-ai providers must not contain duplicates");
  if (!Array.isArray(value.customProviders)) throw new TypeError("provider-pi-ai customProviders must be an array");
  const custom = value.customProviders.map((provider, index) => normalizeCustomProvider(provider, `customProviders[${index}]`));
  const ids = [...value.providers, ...custom.map((provider) => provider.id)]; if (new Set(ids).size !== ids.length) throw new TypeError("provider-pi-ai provider ids must be unique");
  if (typeof value.refreshOnStart !== "boolean") throw new TypeError("provider-pi-ai refreshOnStart must be boolean");
  return { providers: [...value.providers], customProviders: custom as never, refreshOnStart: value.refreshOnStart };
}
async function createConfiguredModels(config: PiAiProviderConfig, credentials?: CredentialService): Promise<MutableModels> {
  const models = createModels(credentials ? { credentials: piCredentialStore(credentials) } : undefined);
  const catalog = new Map(createBuiltinProviders().map((provider) => [provider.id, provider]));
  for (const name of config.providers ?? piAiBuiltinProviders) {
    const provider = catalog.get(name);
    if (!provider) throw new TypeError(`Unknown PI provider: ${name}`);
    models.setProvider(provider);
  }
  for (const provider of config.customProviders ?? []) models.setProvider(createCustomProvider(provider));
  if (config.refreshOnStart === true) await models.refresh({ allowNetwork: true });
  return models;
}

function normalizeCustomProvider(value: unknown, label: string): PiAiCustomProvider {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const id = requiredIdentifier(typeof value.id === "string" ? value.id : "", `${label} id`);
  if (typeof value.baseUrl !== "string") throw new TypeError(`${label} baseUrl must be a string`);
  const baseUrl = normalizeBaseUrl(value.baseUrl); const api = value.api ?? "openai-completions";
  if (api !== "openai-completions" && api !== "openai-responses" && api !== "anthropic-messages") throw new TypeError(`${label} api is unsupported`);
  if (!Array.isArray(value.models) || value.models.length === 0) throw new TypeError(`${label} must define at least one model`);
  const models = value.models.map((entry, index): PiAiCustomModel => {
    if (!isRecord(entry)) throw new TypeError(`${label}.models[${index}] must be an object`);
    const modelId = requiredIdentifier(typeof entry.id === "string" ? entry.id : "", `${label}.models[${index}] id`);
    const positive = (field: "contextWindow" | "maxOutputTokens"): number | undefined => { const fieldValue = entry[field]; if (fieldValue === undefined) return; if (!Number.isSafeInteger(fieldValue) || (fieldValue as number) <= 0) throw new TypeError(`${label}.models[${index}].${field} must be a positive integer`); return fieldValue as number; };
    if (entry.name !== undefined && typeof entry.name !== "string") throw new TypeError(`${label}.models[${index}].name must be a string`);
    if (entry.reasoning !== undefined && typeof entry.reasoning !== "boolean") throw new TypeError(`${label}.models[${index}].reasoning must be boolean`);
    if (entry.input !== undefined && (!Array.isArray(entry.input) || entry.input.some((kind) => kind !== "text" && kind !== "image"))) throw new TypeError(`${label}.models[${index}].input must contain text or image`);
    const contextWindow = positive("contextWindow"); const maxOutputTokens = positive("maxOutputTokens");
    return { id: modelId, ...(entry.name === undefined ? {} : { name: entry.name }), ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }), ...(entry.reasoning === undefined ? {} : { reasoning: entry.reasoning }), ...(entry.input === undefined ? {} : { input: [...entry.input] as ("text" | "image")[] }) };
  });
  if (new Set(models.map((model) => model.id)).size !== models.length) throw new TypeError(`${label} model ids must be unique`);
  let headers: Record<string, string> | undefined;
  if (value.headers !== undefined) { if (!isRecord(value.headers) || Object.values(value.headers).some((entry) => typeof entry !== "string")) throw new TypeError(`${label}.headers must contain string values`); headers = { ...value.headers } as Record<string, string>; }
  if (value.name !== undefined && typeof value.name !== "string") throw new TypeError(`${label}.name must be a string`);
  return { id, ...(value.name === undefined ? {} : { name: value.name }), baseUrl, api, models, ...(headers === undefined ? {} : { headers }) };
}

export function createCustomProvider(config: PiAiCustomProvider): Provider {
  const normalized = normalizeCustomProvider(config, "custom provider");
  const { id, baseUrl } = normalized;
  const api = normalized.api ?? "openai-completions";
  const models = normalized.models.map((model) => toPiModel(normalized, model));
  const environmentName = `${id.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
  return createProvider({
    id,
    name: normalized.name?.trim() || id,
    baseUrl,
    auth: { apiKey: envApiKeyAuth(`${config.name?.trim() || id} API key`, [environmentName]) },
    models,
    ...(normalized.headers === undefined ? {} : { headers: { ...normalized.headers } }),
    api: providerApi(api),
  });
}

export async function discoverProviderModels(request: DiscoverModelsRequest): Promise<readonly PiAiCustomModel[]> {
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const fetcher = request.fetch ?? globalThis.fetch;
  const response = await fetcher(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(request.apiKey === undefined || request.apiKey === ""
        ? {}
        : { authorization: `Bearer ${request.apiKey}` }),
      ...request.headers,
    },
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  if (!response.ok) throw new Error(`Model discovery failed with HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4_194_304) {
    throw new Error("Model discovery response is too large");
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > 4_194_304) throw new Error("Model discovery response is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new Error("Model discovery response is not valid JSON"); }
  const models = parseModelCatalog(parsed);
  if (models.length === 0) throw new Error("Model discovery returned no usable models");
  return models;
}

export function parseModelCatalog(value: unknown): readonly PiAiCustomModel[] {
  if (!isRecord(value)) return [];
  const source: Array<[string | undefined, unknown]> = Array.isArray(value.data)
    ? value.data.map((entry) => [undefined, entry])
    : isRecord(value.models)
      ? Object.entries(value.models)
      : Array.isArray(value.models)
        ? value.models.map((entry) => [undefined, entry])
        : [];
  const seen = new Set<string>();
  const output: PiAiCustomModel[] = [];
  for (const [key, entry] of source) {
    const item = isRecord(entry) ? entry : undefined;
    const id = firstString(item?.id, key);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const name = firstString(item?.name, item?.display_name, item?.displayName);
    const contextWindow = firstPositiveInteger(
      item?.contextWindow, item?.context_window, item?.context_length, item?.max_input_tokens,
      isRecord(item?.limit) ? item.limit.context : undefined,
    );
    const maxOutputTokens = firstPositiveInteger(
      item?.maxOutputTokens, item?.max_output_tokens, item?.maxTokens,
      isRecord(item?.limit) ? item.limit.output : undefined,
    );
    output.push({
      id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(typeof item?.reasoning === "boolean" ? { reasoning: item.reasoning } : {}),
    });
  }
  return output;
}

function toModelInfo(model: Model<any>): ModelInfo {
  return {
    provider: model.provider,
    model: model.id,
    displayName: model.name,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    supportsReasoning: model.reasoning,
    supportsImages: model.input.includes("image"),
  };
}

function toPiModel(
  provider: Omit<PiAiCustomProvider, "models">,
  model: PiAiCustomModel,
): Model<PiAiProviderApi> {
  const id = requiredIdentifier(model.id, "model id");
  const api = provider.api ?? "openai-completions";
  return {
    id,
    name: model.name?.trim() || id,
    api,
    provider: requiredIdentifier(provider.id, "provider id"),
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    reasoning: model.reasoning ?? false,
    input: [...(model.input ?? ["text"])],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxOutputTokens ?? 8_192,
  };
}

function providerApi(api: PiAiProviderApi) {
  switch (api) {
    case "openai-completions": return openAICompletionsApi();
    case "openai-responses": return openAIResponsesApi();
    case "anthropic-messages": return anthropicMessagesApi();
  }
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("Provider baseUrl must be a valid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider baseUrl must use http or https");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function requiredIdentifier(value: string, label: string): string {
  const result = value.trim();
  if (result.length === 0) throw new Error(`${label} must not be empty`);
  if (result.includes("/")) throw new Error(`${label} must not contain /`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  }
  return undefined;
}

function fromPiEvent(event: AssistantMessageEvent, route: import("@seal-harness/core").ModelRef): ModelStreamEvent[] {
  switch (event.type) {
    case "text_delta": return [{ type: "text_delta", delta: event.delta }];
    case "thinking_delta": return [{ type: "reasoning_delta", delta: event.delta }];
    case "toolcall_end":
      return [{
        type: "tool_call",
        call: {
          type: "tool_call",
          id: toolCallId(event.toolCall.id),
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
        },
      }];
    case "done":
      {
        const replay = replayState(event.message);
      return [
        { type: "usage", usage: fromUsage(event.message.usage, route) },
        { type: "done", stopReason: fromStopReason(event.reason), replayState: replay },
      ];
      }
    case "error":
      return [
        { type: "usage", usage: fromUsage(event.error.usage, route) },
        { type: "done", stopReason: event.reason },
      ];
    default:
      return [];
  }
}

function replayState(message: Parameters<typeof fromPiAssistantMessage>[0]): import("@seal-harness/core").ModelReplayState {
  const converted = fromPiAssistantMessage(message);
  return {
    response: converted.providerData ?? {},
    blocks: converted.content.map((block) => "providerData" in block ? block.providerData ?? null : null),
  };
}

function fromUsage(usage: Usage, route: import("@seal-harness/core").ModelRef): ModelUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
    routes: [route],
    costUsd: usage.cost.total,
  };
}

function fromStopReason(reason: "stop" | "length" | "toolUse" | "deferred"): ModelStopReason {
  return reason === "toolUse" || reason === "deferred" ? "tool_call" : reason;
}
