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
  readonly id: ToolCallId;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface UserMessage {
  readonly role: "user";
  readonly content: readonly ContentBlock[];
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: readonly ContentBlock[];
  readonly reasoning?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolResultMessage {
  readonly role: "tool";
  readonly callId: ToolCallId;
  readonly name: string;
  readonly content: readonly ContentBlock[];
  readonly isError: boolean;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export function text(textValue: string): TextBlock {
  return { type: "text", text: textValue };
}

export function userMessage(textValue: string): UserMessage {
  return { role: "user", content: [text(textValue)] };
}
