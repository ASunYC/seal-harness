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
  ModelService,
  ModelStopReason,
  ModelUsage,
} from "@piharness/core";
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

function bridgeRequest(
  modelService: ModelService,
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void pump(modelService, model, context, options, output);
  return output;
}

async function pump(
  modelService: ModelService,
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  output: AssistantMessageEventStream,
): Promise<void> {
  const partial = createPartial(model);
  output.push({ type: "start", partial });
  let open: { type: "text" | "thinking"; index: number } | undefined;
  let terminal = false;

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

  try {
    const stream = modelService.stream({
      model: { provider: model.provider, model: model.id },
      systemPrompt: context.systemPrompt ?? "",
      messages: fromPiMessages(context.messages),
      tools: (context.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool.parameters),
      })),
      signal: options?.signal ?? new AbortController().signal,
      ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options?.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
      ...(options?.reasoning === undefined ? {} : { reasoning: normalizeReasoning(options.reasoning) }),
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
          partial.usage = toPiUsage(event.usage);
          break;
        case "done": {
          closeOpenBlock();
          terminal = true;
          finish(output, partial, event.stopReason);
          break;
        }
      }
      if (terminal) break;
    }

    if (!terminal) {
      closeOpenBlock();
      finish(output, partial, options?.signal?.aborted === true ? "aborted" : "stop");
    }
  } catch (error) {
    closeOpenBlock();
    partial.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
    partial.errorMessage = error instanceof Error ? error.message : String(error);
    output.push({ type: "error", reason: partial.stopReason, error: partial });
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
    api: "piharness-model",
    provider: info.provider,
    baseUrl: "piharness://model-service",
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

function toPiUsage(usage: ModelUsage): Usage {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    totalTokens: usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: usage.costUsd ?? 0,
    },
  };
}

function toJsonSchema(value: unknown): JsonSchema {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
