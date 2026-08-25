import type { JsonObject } from "./json.js";
import type { ToolCallId } from "./ids.js";

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

export type AssistantContentBlock = TextBlock | ReasoningBlock | ToolCall;

export interface UserMessage {
  readonly role: "user";
  readonly content: readonly ContentBlock[];
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: readonly AssistantContentBlock[];
  readonly providerData?: JsonObject;
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
