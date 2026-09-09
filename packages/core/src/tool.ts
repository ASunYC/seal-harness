import type { ContentBlock, UserMessage } from "./content.js";
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
  /** Report a nested orchestration dispatch for durable session projection. */
  readonly reportDispatch?: (event: ToolDispatchEvent) => Promise<void>;
}

export type ToolDispatchEvent =
  | {
      readonly type: "start";
      readonly rootCallId: ToolCallId;
      readonly parentCallId: ToolCallId;
      readonly subCallId: ToolCallId;
      readonly name: string;
      readonly arguments: JsonValue;
    }
  | {
      readonly type: "settle";
      readonly rootCallId: ToolCallId;
      readonly parentCallId: ToolCallId;
      readonly subCallId: ToolCallId;
      readonly name: string;
      readonly arguments: JsonValue;
      readonly result: ToolResult;
    };

export interface ToolResult {
  readonly content: readonly ContentBlock[];
  readonly details?: JsonValue;
  readonly isError?: boolean;
  /** Context injected before the next model step, in result commit order. */
  readonly additionalContexts?: readonly UserMessage[];
  /** Gracefully close this agent turn after queued context and steering drain. */
  readonly concludesTurn?: true;
}

export interface ToolDefinition<TInput extends JsonObject = JsonObject> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly timeoutMs?: number;
  /** False keeps the tool callable by orchestration transports while omitting it from model schemas. */
  readonly modelVisible?: boolean;
  classify(input: TInput, context: Omit<ToolExecutionContext, "reportProgress" | "reportDispatch">): ToolPolicyAction;
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
  readonly reportDispatch?: (event: ToolDispatchEvent) => Promise<void>;
}

export interface ToolGuardExecution {
  readonly callId: ToolCallId;
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly name: string;
  readonly input: JsonObject;
  readonly action: ToolPolicyAction;
  readonly signal: AbortSignal;
}

export type ToolGuard = (execution: ToolGuardExecution) => string | undefined;
export interface ToolRestriction { readonly allow?: readonly string[]; readonly deny?: readonly string[] }

export interface ToolRegistrationOptions {
  /** Restrict this definition and its execution to one Session. */
  readonly ownerSession?: SessionId;
}

export interface ToolService {
  register(tool: ToolDefinition, options?: ToolRegistrationOptions): () => void;
  restrict?(filter: ToolRestriction, options: { readonly ownerSession: SessionId }): () => void;
  guard?(guard: ToolGuard, options?: ToolRegistrationOptions): () => void;
  /** Install a model-schema visibility filter without changing execution reachability. */
  filterModelDefinitions?(filter: (definition: ModelToolDefinition, sessionId?: SessionId) => boolean): () => void;
  definitions(sessionId?: SessionId, options?: { readonly includeHidden?: boolean }): readonly ModelToolDefinition[];
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
