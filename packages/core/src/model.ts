import type { AgentMessage } from "./content.js";
import type { JsonSchema } from "./json.js";

export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

export interface ModelInfo extends ModelRef {
  readonly displayName?: string;
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
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: number;
}

export type ModelStopReason = "stop" | "tool_call" | "length" | "aborted" | "error";

export type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "reasoning_delta"; readonly delta: string }
  | { readonly type: "tool_call"; readonly call: import("./content.js").ToolCall }
  | { readonly type: "usage"; readonly usage: ModelUsage }
  | { readonly type: "done"; readonly stopReason: ModelStopReason };

export interface ModelService {
  list(): Promise<readonly ModelInfo[]>;
  get(ref: ModelRef): Promise<ModelInfo | undefined>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
