import {
  createModels,
  type AssistantMessageEvent,
  type Model,
  type Models,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import {
  builtinProviders,
  getBuiltinProviders,
  type BuiltinProvider,
} from "@earendil-works/pi-ai/providers/all";
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
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
import { toPiLlmMessages } from "@seal-harness/runtime-pi";
import { Type } from "typebox";

export type PiAiBuiltinProvider = BuiltinProvider;

/** The complete provider catalog shipped by the installed pi-ai version. */
export const PI_AI_BUILTIN_PROVIDERS: readonly PiAiBuiltinProvider[] = getBuiltinProviders();

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

  /**
   * Reports whether the provider can authenticate without exposing credential
   * material. Explicit Seal Harness credentials and provider-native ambient
   * auth (including AWS, ADC, and OAuth stores) are both considered.
   */
  async isProviderConfigured(provider: string): Promise<boolean> {
    if (this.models.getProvider(provider) === undefined) return false;
    const apiKey = await this.credentials?.resolve({ provider, name: "apiKey" });
    if (apiKey !== undefined) {
      return (await this.models.getAuth(provider, { apiKey })) !== undefined;
    }
    return (await this.models.checkAuth(provider)) !== undefined;
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

export const piAiProviderPlugin = definePlugin<PiAiProviderConfig, SealHarnessEvents>({
  name: "provider-pi-ai",
  provides: [modelServiceToken],
  optional: [credentialServiceToken],
  async setup(context, config) {
    const models = createModels();
    const available = new Map(builtinProviders().map((provider) => [provider.id, provider]));
    for (const name of config.providers ?? ["deepseek"]) {
      const provider = available.get(name);
      if (provider === undefined) throw new Error(`Unknown built-in pi-ai provider: ${name}`);
      models.setProvider(provider);
    }
    if (config.refreshOnStart === true) {
      await models.refresh({ allowNetwork: true });
    }
    const credentials = context.has(credentialServiceToken)
      ? context.use(credentialServiceToken)
      : undefined;
    context.provide(modelServiceToken, new PiAiModelService(models, credentials));
  },
});

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
