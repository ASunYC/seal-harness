import type { JsonObject, JsonValue } from "./json.js";
import type { MessageId, ToolCallId } from "./ids.js";

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ImageBlock {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export interface AttachmentBlock {
  readonly type: "attachment";
  readonly id: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly bytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly originalDimensions?: { readonly width: number; readonly height: number };
  readonly providerData?: JsonObject;
}

export type ContentBlock = TextBlock | ImageBlock | AttachmentBlock;

export interface ToolCall {
  readonly type: "tool_call";
  readonly id: ToolCallId;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly providerData?: JsonObject;
}

export interface ReasoningBlock {
  readonly type: "reasoning";
  readonly text: string;
  readonly providerData?: JsonObject;
}

export type AssistantContentBlock = TextBlock | ImageBlock | AttachmentBlock | ReasoningBlock | ToolCall;

export interface ModelReplayState {
  /** Replayable provider state for a successful stop, tool call, or token limit terminal. */
  readonly response: JsonValue;
  readonly blocks?: readonly JsonValue[];
}

export interface UserMessage {
  readonly id?: MessageId;
  readonly role: "user";
  readonly content: readonly ContentBlock[];
  /** Optional durable producer identity; adapters preserve unknown JSON fields. */
  readonly source?: JsonObject;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: readonly AssistantContentBlock[];
  readonly providerData?: JsonObject;
  readonly replayState?: ModelReplayState;
}

export interface ToolResultMessage {
  readonly role: "tool";
  readonly callId: ToolCallId;
  readonly name: string;
  readonly content: readonly ContentBlock[];
  readonly isError: boolean;
  readonly providerData?: JsonObject;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export function text(textValue: string): TextBlock {
  return { type: "text", text: textValue };
}

export function userMessage(textValue: string): UserMessage {
  return { role: "user", content: [text(textValue)] };
}
