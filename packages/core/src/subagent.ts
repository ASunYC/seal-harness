import type { AgentMessage } from "./content.js";
import type { MessageId, SessionId } from "./ids.js";
import type { ModelRef } from "./model.js";
import type { JsonSchema, JsonValue } from "./json.js";

export type SubagentStatus = "running" | "completed" | "failed" | "aborted";

export interface SubagentSnapshot {
  readonly sessionId: SessionId;
  readonly parentSessionId: SessionId;
  readonly label: string;
  /** Original delegation task, retained independently of subsequent messages. */
  readonly task?: string;
  readonly status: SubagentStatus;
  readonly model: ModelRef;
  /** Latest execution timestamps from the durable session log, not UI mount time. */
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly jobId?: string;
  readonly result?: string;
  /** Validated value reported through the per-child structured_output tool. */
  readonly structuredResult?: JsonValue;
  readonly error?: string;
}

export interface SpawnSubagentRequest {
  /** Optional caller-reserved durable identity; rejected if already present. */
  readonly sessionId?: SessionId;
  readonly parentSessionId: SessionId;
  readonly cwd: string;
  readonly prompt: string;
  readonly label?: string;
  readonly model?: ModelRef;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  /** Optional object schema for a fresh child's required structured result. */
  readonly outputSchema?: JsonSchema;
  /** Seed the child with the parent's transcript through its last completed run. */
  readonly inheritParentContext?: boolean;
}

export interface WaitSubagentsResult {
  readonly completed: readonly SubagentSnapshot[];
  readonly timedOut: boolean;
}

/** Durable child-Agent ownership plus live execution control. */
export interface SubagentService {
  spawn(request: SpawnSubagentRequest): Promise<SubagentSnapshot>;
  list(parentSessionId: SessionId): Promise<readonly SubagentSnapshot[]>;
  wait(parentSessionId: SessionId, sessionIds: readonly SessionId[], timeoutMs: number, signal?: AbortSignal): Promise<WaitSubagentsResult>;
  send(parentSessionId: SessionId, sessionId: SessionId, message: AgentMessage): Promise<SubagentSnapshot>;
  abort(parentSessionId: SessionId, sessionId: SessionId, reason?: unknown): Promise<boolean>;
  /** List the complete durable descendant tree owned by an ancestor. */
  listDescendants?(parentSessionId: SessionId): Promise<readonly SubagentSnapshot[]>;
  /** Deliver between an exact direct parent/child pair in either direction. */
  sendMessage?(senderSessionId: SessionId, targetSessionId: SessionId, message: AgentMessage): Promise<MessageId>;
  /** Interrupt a direct or transitive descendant while retaining its durable Session. */
  interrupt?(ancestorSessionId: SessionId, targetSessionId: SessionId, reason?: unknown): Promise<boolean>;
}
