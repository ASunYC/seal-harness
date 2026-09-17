import type {
  AgentMessage as CoreMessage,
  AssistantMessage as CoreAssistantMessage,
  AssistantContentBlock,
  ContentBlock,
  JsonObject,
  JsonValue,
} from "@seal-harness/core";
import { toolCallId } from "@seal-harness/core";
import type {
  AssistantMessage as PiAssistantMessage,
  Message as PiLlmMessage,
  Model,
  TextContent as PiTextContent,
  ImageContent as PiImageContent,
} from "@earendil-works/pi-ai";
import type { AgentMessage as PiAgentMessage } from "@earendil-works/pi-agent-core";
import { convertToLlm } from "@earendil-works/pi-coding-agent";

type PiMessage = PiLlmMessage;

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function toPiMessages(messages: readonly CoreMessage[], model: Model<any>): PiAgentMessage[] {
  return messages.map((message) => toPiMessage(message, model));
}

export function toPiMessage(message: CoreMessage, model: Model<any>): PiMessage {
  const now = Date.now();
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content.map(toPiVisibleBlock),
      timestamp: now,
      ...(message.source === undefined ? {} : { sealSource: message.source }),
      ...(message.id === undefined ? {} : { sealMessageId: message.id }),
    } as PiMessage;
  }

  if (message.role === "tool") {
    return {
      role: "toolResult",
      toolCallId: message.callId,
      toolName: message.name,
      content: message.content.map(toPiVisibleBlock),
      isError: message.isError,
      timestamp: readNumber(message.providerData, "timestamp") ?? now,
    };
  }

  return {
    role: "assistant",
    content: message.content.map(toPiAssistantBlock),
    api: readString(message.providerData, "api") ?? model.api,
    provider: readString(message.providerData, "provider") ?? model.provider,
    model: readString(message.providerData, "model") ?? model.id,
    usage: EMPTY_USAGE,
    stopReason: toPiStopReason(readString(message.providerData, "stopReason")),
    timestamp: readNumber(message.providerData, "timestamp") ?? now,
    ...(message.replayState === undefined ? {} : { sealReplayState: message.replayState }),
  };
}

export function fromPiMessages(messages: readonly PiAgentMessage[]): CoreMessage[] {
  return messages.flatMap((message) => {
    if (isPiMessage(message)) return [fromPiMessage(message)];
    if (message.role === "compactionSummary") return convertToLlm([message]).map(fromPiMessage);
    return [];
  });
}

export function fromPiMessage(message: PiMessage): CoreMessage {
  if (message.role === "user") {
    const content = typeof message.content === "string"
      ? [{ type: "text" as const, text: message.content }]
      : message.content.map(fromPiVisibleBlock);
    const source = readJsonObject(message as unknown as Record<string, unknown>, "sealSource");
    const id = readString(message as unknown as JsonObject, "sealMessageId");
    return { role: "user", content, ...(id === undefined ? {} : { id: id as import("@seal-harness/core").MessageId }), ...(source === undefined ? {} : { source }) };
  }

  if (message.role === "toolResult") {
    return {
      role: "tool",
      callId: toolCallId(message.toolCallId),
      name: message.toolName,
      content: message.content.map(fromPiVisibleBlock),
      isError: message.isError,
      providerData: compactJson({ timestamp: message.timestamp }),
    };
  }

  return fromPiAssistantMessage(message);
}

export function fromPiAssistantMessage(message: PiAssistantMessage): CoreAssistantMessage {
  const replayState = (message as PiAssistantMessage & { sealReplayState?: import("@seal-harness/core").ModelReplayState }).sealReplayState;
  return {
    role: "assistant",
    content: message.content.map((block): AssistantContentBlock => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "thinking") {
        return {
          type: "reasoning",
          text: block.thinking,
          providerData: compactJson({
            thinkingSignature: block.thinkingSignature,
            redacted: block.redacted,
          }),
        };
      }
      return {
        type: "tool_call",
        id: toolCallId(block.id),
        name: block.name,
        arguments: block.arguments as JsonObject,
        providerData: compactJson({
          thoughtSignature: block.thoughtSignature,
          namespace: block.namespace,
        }),
      };
    }),
    providerData: compactJson({
      api: message.api,
      provider: message.provider,
      model: message.model,
      responseModel: message.responseModel,
      responseId: message.responseId,
      stopReason: message.stopReason,
      rawStopReason: message.rawStopReason,
      timestamp: message.timestamp,
    }),
    ...(replayState === undefined ? {} : { replayState }),
  };
}

export function toPiLlmMessages(messages: readonly CoreMessage[], model: Model<any>): PiLlmMessage[] {
  return toPiMessages(messages, model) as PiLlmMessage[];
}

function toPiVisibleBlock(block: ContentBlock): PiTextContent | PiImageContent {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") {
    return { type: "image", data: block.data, mimeType: block.mimeType };
  }
  throw new TypeError(`Attachment ${block.id} must be resolved before entering the Pi runtime`);
}

function fromPiVisibleBlock(block: PiTextContent | PiImageContent): ContentBlock {
  return block.type === "text"
    ? { type: "text", text: block.text }
    : { type: "image", data: block.data, mimeType: block.mimeType };
}

function toPiAssistantBlock(block: AssistantContentBlock): PiAssistantMessage["content"][number] {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") return { type: "text", text: `[assistant image ${block.mimeType}]` };
  if (block.type === "attachment") throw new TypeError(`Assistant attachment ${block.id} must be resolved before entering the Pi runtime`);
  if (block.type === "reasoning") {
    const thinkingSignature = readString(block.providerData, "thinkingSignature");
    const redacted = readBoolean(block.providerData, "redacted");
    return {
      type: "thinking",
      thinking: block.text,
      ...(thinkingSignature === undefined ? {} : { thinkingSignature }),
      ...(redacted === undefined ? {} : { redacted }),
    };
  }
  const thoughtSignature = readString(block.providerData, "thoughtSignature");
  const namespace = readString(block.providerData, "namespace");
  return {
    type: "toolCall",
    id: block.id,
    name: block.name,
    arguments: { ...block.arguments },
    ...(thoughtSignature === undefined ? {} : { thoughtSignature }),
    ...(namespace === undefined ? {} : { namespace }),
  };
}

function toPiStopReason(value: string | undefined): PiAssistantMessage["stopReason"] {
  switch (value) {
    case "length": return "length";
    case "toolUse":
    case "tool_call": return "toolUse";
    case "error": return "error";
    case "aborted": return "aborted";
    case "deferred": return "deferred";
    default: return "stop";
  }
}

function readString(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(object: JsonObject | undefined, key: string): number | undefined {
  const value = object?.[key];
  return typeof value === "number" ? value : undefined;
}

function readBoolean(object: JsonObject | undefined, key: string): boolean | undefined {
  const value = object?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readJsonObject(object: Record<string, unknown>, key: string): JsonObject | undefined {
  const value = object[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function compactJson(values: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}
