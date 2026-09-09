import type { AgentMessage, AssistantMessage, ContentBlock, ToolCall, UserMessage } from "./content.js";
import type { RunId, SessionId, ToolCallId } from "./ids.js";
import type { ModelRef, ModelStopReason, ModelToolDefinition, ModelUsage } from "./model.js";
import type { ToolResult } from "./tool.js";
import type { ToolDispatchEvent } from "./tool.js";

export interface RuntimeStartRequest {
  readonly runId: RunId;
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly model: ModelRef;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  readonly maxTokens?: number;
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly pendingMessages?: readonly PendingAgentMessage[];
  /** User messages claimed for the first proposed step, excluding prior history. */
  readonly initialStepMessages?: readonly UserMessage[];
  readonly signal?: AbortSignal;
  /** Optional execution-bound interception used by compatibility runtimes. */
  readonly hooks?: AgentRuntimeHooks;
}

export interface RuntimeModelRequestConfig {
  readonly model: ModelRef;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  readonly maxTokens?: number;
}

export interface AgentRuntimeHooks {
  preStep?(input: {
    readonly turn: number;
    readonly step: number;
    readonly signal: AbortSignal;
    readonly messages: readonly UserMessage[];
  }): Promise<{ readonly kind: "reject" } | { readonly kind: "enter"; readonly messages: readonly UserMessage[] }>;
  request?(input: {
    readonly turn: number;
    readonly step: number;
    readonly signal: AbortSignal;
    readonly config: RuntimeModelRequestConfig;
  }): Promise<RuntimeModelRequestConfig>;
  requestError?(input: {
    readonly turn: number;
    readonly step: number;
    readonly signal: AbortSignal;
    readonly provider: string;
    readonly failure: { readonly message: string; readonly code: string };
  }): Promise<"retry" | undefined>;
  turnStopping?(input: {
    readonly turn: number;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export type RuntimeEvent =
  | { readonly type: "run_start"; readonly runId: RunId }
  | { readonly type: "turn_start"; readonly index: number }
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "reasoning_delta"; readonly delta: string }
  | { readonly type: "user_message"; readonly message: UserMessage }
  | { readonly type: "pre_step"; readonly original: readonly UserMessage[]; readonly messages: readonly UserMessage[]; readonly rejected: boolean }
  | { readonly type: "request_header"; readonly header: { readonly config: { readonly provider: string; readonly model: string; readonly reasoningEffort?: "off" | "low" | "medium" | "high" | "max"; readonly maxTokens?: number }; readonly system?: string; readonly tools?: readonly ModelToolDefinition[] }; readonly reason: "initial" | "resume" | "change" | "series"; readonly startsSeries?: boolean }
  | { readonly type: "assistant_message"; readonly message: AssistantMessage; readonly usage?: ModelUsage; readonly stopReason?: ModelStopReason; readonly interrupted?: true }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "tool_progress"; readonly callId: ToolCallId; readonly content: readonly ContentBlock[] }
  | { readonly type: "tool_dispatch"; readonly event: ToolDispatchEvent }
  | { readonly type: "inbox_spliced"; readonly target: "next-turn" | "next-step"; readonly start: number; readonly removedCount?: number; readonly removed?: readonly UserMessage[]; readonly inserted: readonly UserMessage[]; readonly outcome?: "canceled" }
  | { readonly type: "tool_result"; readonly callId: ToolCallId; readonly name: string; readonly result: ToolResult }
  | { readonly type: "turn_end"; readonly index: number; readonly usage?: ModelUsage; readonly firstTokenAt?: number; readonly stopReason?: ModelStopReason }
  | { readonly type: "run_end"; readonly stopReason: ModelStopReason }
  | { readonly type: "run_error"; readonly step: number; readonly error: unknown };

export interface RuntimeResult {
  readonly messages: readonly AgentMessage[];
  readonly stopReason: ModelStopReason;
  readonly usage?: ModelUsage;
  readonly errorMessage?: string;
}

export interface PendingAgentMessage {
  readonly id: import("./ids.js").MessageId;
  readonly placement: "queued" | "steering";
  readonly message: UserMessage;
}

export type PendingMessageAction =
  | { readonly kind: "edit"; readonly content: readonly ContentBlock[] }
  | { readonly kind: "remove" }
  | { readonly kind: "steer" };

export type PendingMessageUpdate = "updated" | "not-found" | "steer-unavailable";

export interface AgentRun extends AsyncIterable<RuntimeEvent> {
  readonly result: Promise<RuntimeResult>;
  abort(reason?: unknown): void;
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
  /** Awaited in registration order; use for durability barriers, not passive UI rendering. */
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void;
  /** Optional live inbox capability; implementations must expose their actual consumed queue. */
  pendingMessages?(): readonly PendingAgentMessage[];
  updatePendingMessage?(id: import("./ids.js").MessageId, action: PendingMessageAction): PendingMessageUpdate;
  splicePending?(placement: PendingAgentMessage["placement"], start: number, deleteCount: number, inserted: readonly UserMessage[]): readonly UserMessage[];
  subscribePending?(listener: (messages: readonly PendingAgentMessage[]) => void): () => void;
}

export interface AgentRuntime {
  start(request: RuntimeStartRequest): AgentRun;
}
