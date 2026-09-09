import type { AgentMessage, ModelReplayState } from "./content.js";
import type { JsonSchema } from "./json.js";
import type { SessionId } from "./ids.js";

export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

export interface ModelInfo extends ModelRef {
  readonly displayName?: string;
  readonly description?: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsReasoning?: boolean;
  readonly supportsImages?: boolean;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface ModelRequest {
  readonly model: ModelRef;
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly signal: AbortSignal;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Exact stop sequences requested by the caller; adapters must honor or explicitly reject them. */
  readonly stop?: readonly string[];
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  /** Optional durable Session attribution for auxiliary and main model calls. */
  readonly sessionId?: SessionId;
  /** Stable caller intent such as compaction or session-title. */
  readonly purpose?: string;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Exact provider-reported aggregate when available. */
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  /** Unique provider/model routes for the billed attempts, when every attempt is attributed. */
  readonly routes?: readonly ModelRef[];
  readonly costUsd?: number;
}

export type ModelStopReason = "stop" | "tool_call" | "length" | "aborted" | "error";

export type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "reasoning_delta"; readonly delta: string }
  | { readonly type: "tool_call"; readonly call: import("./content.js").ToolCall }
  | { readonly type: "usage"; readonly usage: ModelUsage }
  | { readonly type: "done"; readonly stopReason: ModelStopReason; readonly replayState?: ModelReplayState };

export interface ModelService {
  list(): Promise<readonly ModelInfo[]>;
  get(ref: ModelRef): Promise<ModelInfo | undefined>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
