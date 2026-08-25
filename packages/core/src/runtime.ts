import type { AgentMessage, AssistantMessage, ContentBlock, ToolCall, UserMessage } from "./content.js";
import type { RunId, SessionId, ToolCallId } from "./ids.js";
import type { ModelRef, ModelStopReason, ModelUsage } from "./model.js";
import type { ToolResult } from "./tool.js";

export interface RuntimeStartRequest {
  readonly runId: RunId;
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly model: ModelRef;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly signal?: AbortSignal;
}

export type RuntimeEvent =
  | { readonly type: "run_start"; readonly runId: RunId }
  | { readonly type: "turn_start"; readonly index: number }
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "reasoning_delta"; readonly delta: string }
  | { readonly type: "user_message"; readonly message: UserMessage }
  | { readonly type: "assistant_message"; readonly message: AssistantMessage }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "tool_progress"; readonly callId: ToolCallId; readonly content: readonly ContentBlock[] }
  | { readonly type: "tool_result"; readonly callId: ToolCallId; readonly name: string; readonly result: ToolResult }
  | { readonly type: "turn_end"; readonly index: number; readonly usage?: ModelUsage }
  | { readonly type: "run_end"; readonly stopReason: ModelStopReason };

export interface RuntimeResult {
  readonly messages: readonly AgentMessage[];
  readonly stopReason: ModelStopReason;
  readonly usage?: ModelUsage;
  readonly errorMessage?: string;
}

export interface AgentRun extends AsyncIterable<RuntimeEvent> {
  readonly result: Promise<RuntimeResult>;
  abort(reason?: unknown): void;
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
  /** Awaited in registration order; use for durability barriers, not passive UI rendering. */
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void;
}

export interface AgentRuntime {
  start(request: RuntimeStartRequest): AgentRun;
}
