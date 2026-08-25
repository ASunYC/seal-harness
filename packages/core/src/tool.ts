import type { ContentBlock } from "./content.js";
import type { SessionId, ToolCallId } from "./ids.js";
import type { JsonObject, JsonSchema, JsonValue } from "./json.js";
import type { ModelToolDefinition } from "./model.js";

export type ToolRisk = "read" | "workspace-write" | "external" | "dangerous";

export interface ToolPolicyAction {
  readonly kind: "tool";
  readonly toolName: string;
  readonly risk: ToolRisk;
  readonly summary: string;
  readonly target?: string;
  readonly metadata?: JsonObject;
}

export interface ToolExecutionContext {
  readonly callId: ToolCallId;
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly reportProgress: (content: readonly ContentBlock[]) => void;
}

export interface ToolResult {
  readonly content: readonly ContentBlock[];
  readonly details?: JsonValue;
  readonly isError?: boolean;
}

export interface ToolDefinition<TInput extends JsonObject = JsonObject> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  classify(input: TInput, context: Omit<ToolExecutionContext, "reportProgress">): ToolPolicyAction;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface ToolExecutionRequest {
  readonly callId: ToolCallId;
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly name: string;
  readonly input: JsonObject;
  readonly signal: AbortSignal;
  readonly reportProgress?: (content: readonly ContentBlock[]) => void;
}

export interface ToolService {
  register(tool: ToolDefinition): () => void;
  definitions(): readonly ModelToolDefinition[];
  execute(request: ToolExecutionRequest): Promise<ToolResult>;
}

export class DuplicateToolError extends Error {
  override readonly name = "DuplicateToolError";

  constructor(readonly toolName: string) {
    super(`Tool is already registered: ${toolName}`);
  }
}

export class ToolNotFoundError extends Error {
  override readonly name = "ToolNotFoundError";

  constructor(readonly toolName: string) {
    super(`Tool is not registered: ${toolName}`);
  }
}

export class InvalidToolInputError extends Error {
  override readonly name = "InvalidToolInputError";

  constructor(readonly toolName: string) {
    super(`Tool input does not match schema: ${toolName}`);
  }
}

export class ToolDeniedError extends Error {
  override readonly name = "ToolDeniedError";

  constructor(
    readonly toolName: string,
    readonly reason: string,
  ) {
    super(`Tool ${toolName} was denied: ${reason}`);
  }
}

export class ApprovalUnavailableError extends Error {
  override readonly name = "ApprovalUnavailableError";

  constructor(readonly toolName: string) {
    super(`Tool ${toolName} requires approval, but no ApprovalService is available`);
  }
}
