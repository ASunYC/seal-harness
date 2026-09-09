import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  JsonObject,
  JsonSchema,
  ModelInfo,
  ModelRef,
  ModelService,
  ModelStopReason,
  ModelUsage,
} from "@seal-harness/core";
import { fromPiMessages } from "./messages.js";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export async function createPiModel(modelService: ModelService, provider: string, model: string): Promise<Model<any>> {
  const info = await modelService.get({ provider, model });
  if (info === undefined) throw new Error(`Unknown model: ${provider}/${model}`);
  return modelInfoToPi(info);
}

export function createModelBridge(modelService: ModelService): StreamFn {
  return (model, context, options) => bridgeRequest(modelService, model, context, options);
}

export interface ModelBridgeRetry {
  (failure: { readonly message: string; readonly code: string }, provider: string, signal: AbortSignal): Promise<{
    readonly model: Model<any>;
    readonly options: SimpleStreamOptions;
  } | undefined>;
}

export function createRetryableModelBridge(modelService: ModelService, retry: ModelBridgeRetry): StreamFn {
  return (model, context, options) => bridgeRequest(modelService, model, context, options, retry);
}

/** Internal zero-content response used when a pre-step interceptor rejects before provider I/O. */
export function createRejectedStepStream(model: Model<any>): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const partial = createPartial(model);
  output.push({ type: "start", partial });
  finish(output, partial, "stop");
  return output;
}

function bridgeRequest(
  modelService: ModelService,
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
  retry?: ModelBridgeRetry,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void pump(modelService, model, context, options, output, retry);
  return output;
}

async function pump(
  modelService: ModelService,
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  output: AssistantMessageEventStream,
  retry?: ModelBridgeRetry,
): Promise<void> {
  let activeModel = model;
  let activeOptions = options;
  const partial = createPartial(activeModel);
  output.push({ type: "start", partial });
  let open: { type: "text" | "thinking"; index: number } | undefined;
  let terminal = false;
  const settledUsage: RoutedUsage[] = [];
  let currentUsage: RoutedUsage | undefined;

  const closeOpenBlock = (): void => {
    if (open === undefined) return;
    const block = partial.content[open.index];
    if (open.type === "text" && block?.type === "text") {
      output.push({ type: "text_end", contentIndex: open.index, content: block.text, partial });
    } else if (open.type === "thinking" && block?.type === "thinking") {
      output.push({ type: "thinking_end", contentIndex: open.index, content: block.thinking, partial });
    }
    open = undefined;
  };

  while (true) try {
    const stream = modelService.stream({
      model: { provider: activeModel.provider, model: activeModel.id },
      systemPrompt: context.systemPrompt ?? "",
      messages: fromPiMessages(context.messages),
      tools: (context.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool.parameters),
      })),
      signal: activeOptions?.signal ?? new AbortController().signal,
      ...(activeOptions?.temperature === undefined ? {} : { temperature: activeOptions.temperature }),
      ...(activeOptions?.maxTokens === undefined ? {} : { maxOutputTokens: activeOptions.maxTokens }),
      ...(activeOptions?.reasoning === undefined ? {} : { reasoning: normalizeReasoning(activeOptions.reasoning) }),
    });

    for await (const event of stream) {
      switch (event.type) {
        case "text_delta": {
          if (open?.type !== "text") {
            closeOpenBlock();
            const index = partial.content.length;
            partial.content.push({ type: "text", text: "" });
            open = { type: "text", index };
            output.push({ type: "text_start", contentIndex: index, partial });
          }
          const block = partial.content[open.index];
          if (block?.type === "text") block.text += event.delta;
          output.push({ type: "text_delta", contentIndex: open.index, delta: event.delta, partial });
          break;
        }
        case "reasoning_delta": {
          if (open?.type !== "thinking") {
            closeOpenBlock();
            const index = partial.content.length;
            partial.content.push({ type: "thinking", thinking: "" });
            open = { type: "thinking", index };
            output.push({ type: "thinking_start", contentIndex: index, partial });
          }
          const block = partial.content[open.index];
          if (block?.type === "thinking") block.thinking += event.delta;
          output.push({ type: "thinking_delta", contentIndex: open.index, delta: event.delta, partial });
          break;
        }
        case "tool_call": {
          closeOpenBlock();
          const index = partial.content.length;
          output.push({ type: "toolcall_start", contentIndex: index, partial });
          const call = {
            type: "toolCall" as const,
            id: event.call.id,
            name: event.call.name,
            arguments: { ...event.call.arguments },
          };
          partial.content.push(call);
          output.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial });
          break;
        }
        case "usage":
          currentUsage = toPiUsage(event.usage, { provider: activeModel.provider, model: activeModel.id });
          partial.usage = aggregatePiUsage([...settledUsage, currentUsage]);
          break;
        case "done": {
          closeOpenBlock();
          if (event.stopReason === "error" && retry !== undefined) throw new Error("Model request failed");
          if (currentUsage !== undefined || settledUsage.length > 0) partial.usage = aggregatePiUsage([...settledUsage, ...(currentUsage === undefined ? [] : [currentUsage])]);
          if (event.replayState !== undefined && event.stopReason !== "error" && event.stopReason !== "aborted") {
            (partial as AssistantMessage & { sealReplayState?: import("@seal-harness/core").ModelReplayState }).sealReplayState = event.replayState;
          }
          terminal = true;
          finish(output, partial, event.stopReason);
          break;
        }
      }
      if (terminal) break;
    }

    if (!terminal) {
      closeOpenBlock();
      finish(output, partial, activeOptions?.signal?.aborted === true ? "aborted" : "stop");
    }
    return;
  } catch (error) {
    closeOpenBlock();
    const signal = activeOptions?.signal ?? new AbortController().signal;
    if (!signal.aborted && retry !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      const next = await retry({ message, code: "UNKNOWN" }, activeModel.provider, signal);
      signal.throwIfAborted();
      if (next !== undefined) {
        if (currentUsage !== undefined) settledUsage.push(currentUsage);
        currentUsage = undefined;
        activeModel = next.model;
        activeOptions = next.options;
        partial.content.splice(0);
        partial.provider = activeModel.provider;
        partial.model = activeModel.id;
        partial.stopReason = "pending";
        partial.usage = settledUsage.length === 0 ? { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } } : aggregatePiUsage(settledUsage);
        delete partial.errorMessage;
        terminal = false;
        continue;
      }
    }
    partial.stopReason = signal.aborted ? "aborted" : "error";
    if (currentUsage !== undefined || settledUsage.length > 0) partial.usage = aggregatePiUsage([...settledUsage, ...(currentUsage === undefined ? [] : [currentUsage])]);
    partial.errorMessage = error instanceof Error ? error.message : String(error);
    output.push({ type: "error", reason: partial.stopReason, error: partial });
    return;
  }
}

function createPartial(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function finish(
  output: AssistantMessageEventStream,
  partial: AssistantMessage,
  reason: ModelStopReason,
): void {
  if (reason === "error" || reason === "aborted") {
    partial.stopReason = reason;
    partial.errorMessage ??= reason === "aborted" ? "Request aborted" : "Model request failed";
    output.push({ type: "error", reason, error: partial });
    return;
  }
  partial.stopReason = reason === "tool_call" ? "toolUse" : reason;
  output.push({ type: "done", reason: partial.stopReason, message: partial });
}

function modelInfoToPi(info: ModelInfo): Model<any> {
  return {
    id: info.model,
    name: info.displayName ?? info.model,
    api: "seal-harness-model",
    provider: info.provider,
    baseUrl: "seal-harness://model-service",
    reasoning: info.supportsReasoning ?? false,
    input: info.supportsImages === true ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxOutputTokens,
  };
}

function normalizeReasoning(value: string): "off" | "low" | "medium" | "high" | "max" {
  if (value === "minimal") return "low";
  if (value === "xhigh") return "max";
  if (value === "low" || value === "medium" || value === "high" || value === "max") return value;
  return "off";
}

type RoutedUsage = Usage & { readonly sealRoutes?: readonly ModelRef[] };

function toPiUsage(usage: ModelUsage, fallbackRoute?: ModelRef): RoutedUsage {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    ...(usage.reasoningTokens === undefined ? {} : { reasoning: usage.reasoningTokens }),
    ...((usage.routes ?? (fallbackRoute === undefined ? undefined : [fallbackRoute])) === undefined ? {} : { sealRoutes: usage.routes ?? [fallbackRoute!] }),
    totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: usage.costUsd ?? 0,
    },
  };
}

function aggregatePiUsage(values: readonly RoutedUsage[]): RoutedUsage {
  const sum = (select: (usage: Usage) => number): number => values.reduce((total, usage) => total + select(usage), 0);
  const reasoning = values.every((usage) => usage.reasoning !== undefined) ? sum((usage) => usage.reasoning!) : undefined;
  const cacheWrite1h = values.every((usage) => usage.cacheWrite1h !== undefined) ? sum((usage) => usage.cacheWrite1h!) : undefined;
  const routes = values.every((usage) => usage.sealRoutes !== undefined) ? uniqueRoutes(values.flatMap((usage) => usage.sealRoutes!)) : undefined;
  return {
    input: sum((usage) => usage.input),
    output: sum((usage) => usage.output),
    cacheRead: sum((usage) => usage.cacheRead),
    cacheWrite: sum((usage) => usage.cacheWrite),
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(routes === undefined ? {} : { sealRoutes: routes }),
    totalTokens: sum((usage) => usage.totalTokens),
    cost: {
      input: sum((usage) => usage.cost.input),
      output: sum((usage) => usage.cost.output),
      cacheRead: sum((usage) => usage.cost.cacheRead),
      cacheWrite: sum((usage) => usage.cost.cacheWrite),
      total: sum((usage) => usage.cost.total),
    },
  };
}

function uniqueRoutes(routes: readonly ModelRef[]): readonly ModelRef[] {
  const unique = new Map<string, ModelRef>();
  for (const route of routes) unique.set(`${route.provider}\0${route.model}`, route);
  return [...unique.values()];
}

function toJsonSchema(value: unknown): JsonSchema {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
