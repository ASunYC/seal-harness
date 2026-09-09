import type { SessionId } from "./ids.js";
export type CommandResult = { readonly kind: "success"; readonly text?: string } | { readonly kind: "error"; readonly text: string };
export interface CommandInvocation { readonly commandId: string; readonly sessionId: SessionId; readonly rawInput: string; readonly signal: AbortSignal }
export interface CommandDefinition { readonly name: string; readonly description: string; readonly input?: { readonly hint: string }; readonly recordInput?: boolean; handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult> }
export interface CommandDescriptor { readonly name: string; readonly description: string; readonly input?: { readonly hint: string } }
export interface CommandExecution { readonly commandId: string; readonly result: CommandResult }
export interface CommandService { register(definition: CommandDefinition): () => void; list(): readonly CommandDescriptor[]; execute(sessionId: SessionId, line: string, signal?: AbortSignal): Promise<CommandExecution | undefined> }
export interface MessageFeedbackItem { readonly messageId: string; readonly rating: "up" | "down"; readonly note?: string; readonly version: string; readonly createdAt: string; readonly updatedAt: string }
export interface MessageFeedbackService { readonly maxNoteBytes?: number; list(sessionId: SessionId): Promise<readonly MessageFeedbackItem[]>; put(request: { readonly sessionId: SessionId; readonly messageId: string; readonly rating: "up" | "down"; readonly note?: string; readonly ifVersion: string | null }): Promise<MessageFeedbackItem>; delete(request: { readonly sessionId: SessionId; readonly messageId: string; readonly ifVersion: string | null }): Promise<boolean> }
export class MessageFeedbackError extends Error { override readonly name = "MessageFeedbackError"; constructor(message: string, readonly code: string, readonly current?: MessageFeedbackItem | null) { super(message); } }
