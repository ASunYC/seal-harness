import {
  createModels,
  type AssistantMessageEvent,
  type Model,
  type Models,
  type MutableModels,
  type Provider,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import {
  credentialServiceToken,
  modelServiceToken,
  toolCallId,
  type CredentialService,
  type ModelInfo,
  type ModelRequest,
  type ModelService,
  type ModelStopReason,
  type ModelStreamEvent,
  type ModelUsage,
  type PiHarnessEvents,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";
import { toPiLlmMessages } from "@piharness/runtime-pi";
import { Type } from "typebox";

export type PiAiBuiltinProvider =
  | "anthropic"
  | "deepseek"
  | "google"
  | "groq"
  | "mistral"
  | "openai"
  | "openrouter"
  | "xai";

export interface PiAiProviderConfig {
  readonly providers?: readonly PiAiBuiltinProvider[];
  readonly refreshOnStart?: boolean;
}

export class PiAiModelService implements ModelService {
  constructor(
    readonly models: Models,
    readonly credentials?: CredentialService,
  ) {}

  async list(): Promise<readonly ModelInfo[]> {
    return this.models.getModels().map(toModelInfo);
  }

  async get(ref: { provider: string; model: string }): Promise<ModelInfo | undefined> {
    const model = this.models.getModel(ref.provider, ref.model);
    return model === undefined ? undefined : toModelInfo(model);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const model = this.models.getModel(request.model.provider, request.model.model);
    if (model === undefined) {
      yield { type: "done", stopReason: "error" };
      return;
    }

    const apiKey = await this.credentials?.resolve({
      provider: request.model.provider,
      name: "apiKey",
      signal: request.signal,
    });
    const options: SimpleStreamOptions = {
      signal: request.signal,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { maxTokens: request.maxOutputTokens }),
      ...(request.reasoning === undefined || request.reasoning === "off"
        ? {}
        : { reasoning: request.reasoning }),
    };
    const stream = this.models.streamSimple(model, {
      systemPrompt: request.systemPrompt,
      messages: toPiLlmMessages(request.messages, model),
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: Type.Unsafe({ ...tool.inputSchema }),
      })),
    }, options);

    for await (const event of stream) {
      const converted = fromPiEvent(event);
      for (const item of converted) yield item;
    }
  }
}

export const piAiProviderPlugin = definePlugin<PiAiProviderConfig, PiHarnessEvents>({
  name: "provider-pi-ai",
  provides: [modelServiceToken],
  optional: [credentialServiceToken],
  async setup(context, config) {
    const models = createModels();
    const providers = await Promise.all((config.providers ?? ["deepseek"]).map(loadProvider));
    for (const provider of providers) models.setProvider(provider);
    if (config.refreshOnStart === true) {
      await models.refresh({ allowNetwork: true });
    }
    const credentials = context.has(credentialServiceToken)
      ? context.use(credentialServiceToken)
      : undefined;
    context.provide(modelServiceToken, new PiAiModelService(models, credentials));
  },
});

async function loadProvider(name: PiAiBuiltinProvider): Promise<Provider> {
  switch (name) {
    case "anthropic": return (await import("@earendil-works/pi-ai/providers/anthropic")).anthropicProvider();
    case "deepseek": return (await import("@earendil-works/pi-ai/providers/deepseek")).deepseekProvider();
    case "google": return (await import("@earendil-works/pi-ai/providers/google")).googleProvider();
    case "groq": return (await import("@earendil-works/pi-ai/providers/groq")).groqProvider();
    case "mistral": return (await import("@earendil-works/pi-ai/providers/mistral")).mistralProvider();
    case "openai": return (await import("@earendil-works/pi-ai/providers/openai")).openaiProvider();
    case "openrouter": return (await import("@earendil-works/pi-ai/providers/openrouter")).openrouterProvider();
    case "xai": return (await import("@earendil-works/pi-ai/providers/xai")).xaiProvider();
  }
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

function fromPiEvent(event: AssistantMessageEvent): ModelStreamEvent[] {
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
      return [
        { type: "usage", usage: fromUsage(event.message.usage) },
        { type: "done", stopReason: fromStopReason(event.reason) },
      ];
    case "error":
      return [
        { type: "usage", usage: fromUsage(event.error.usage) },
        { type: "done", stopReason: event.reason },
      ];
    default:
      return [];
  }
}

function fromUsage(usage: Usage): ModelUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: usage.cost.total,
  };
}

function fromStopReason(reason: "stop" | "length" | "toolUse" | "deferred"): ModelStopReason {
  return reason === "toolUse" || reason === "deferred" ? "tool_call" : reason;
}
