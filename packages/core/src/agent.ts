import type { AgentMessage, ContentBlock } from "./content.js";
import type { RunId, SessionId } from "./ids.js";
import type { ModelRef } from "./model.js";
import type { AgentRun, PendingAgentMessage, PendingMessageAction, PendingMessageUpdate, RuntimeEvent, RuntimeResult } from "./runtime.js";
import type { SessionSnapshot } from "./session.js";
import type { SessionEvent } from "./session.js";

export interface AgentPromptRequest {
  readonly sessionId?: SessionId;
  readonly cwd: string;
  readonly model: ModelRef;
  readonly prompt: readonly ContentBlock[];
  /** Non-waking context queued before this prompt and persisted ahead of the run. */
  readonly injectedMessages?: readonly import("./content.js").UserMessage[];
  readonly promptMessageId?: import("./ids.js").MessageId;
  /** Durable source attached to the accepted human prompt. */
  readonly promptSource?: import("./json.js").JsonObject;
  /** Metadata recorded only when this request creates a new Session. */
  readonly metadata?: import("./json.js").JsonObject;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  /** Optional output-token ceiling retained across compatible Agent wakeups. */
  readonly maxTokens?: number;
  readonly agentPreset?: string;
  readonly signal?: AbortSignal;
  /** Runtime-bound lifecycle interception supplied by a compatibility host. */
  readonly runtimeHooks?: import("./runtime.js").AgentRuntimeHooks;
  /** Plugin-owned events committed atomically before this prompt's messages and run start. */
  readonly preludeEvents?: readonly SessionEvent[];
}

export interface AgentExecutionResult {
  readonly session: SessionSnapshot;
  readonly runtime: RuntimeResult;
}

export interface AgentExecution extends AsyncIterable<RuntimeEvent> {
  readonly sessionId: SessionId;
  readonly runId: RunId;
  readonly result: Promise<AgentExecutionResult>;
  abort(reason?: unknown): void;
  steer(message: AgentMessage, runtimeMessage?: AgentMessage): void;
  followUp(message: AgentMessage, runtimeMessage?: AgentMessage): void;
  pendingMessages?(): readonly PendingAgentMessage[];
  updatePendingMessage?(id: import("./ids.js").MessageId, action: PendingMessageAction): PendingMessageUpdate;
  splicePending?(placement: PendingAgentMessage["placement"], start: number, deleteCount: number, inserted: readonly import("./content.js").UserMessage[]): readonly import("./content.js").UserMessage[];
  subscribePending?(listener: (messages: readonly PendingAgentMessage[]) => void): () => void;
}

export interface AgentService {
  prompt(request: AgentPromptRequest): Promise<AgentExecution>;
  fork(request: AgentForkRequest): Promise<SessionSnapshot>;
  /** Return the exact currently active execution for cross-transport control. */
  active?(sessionId: SessionId): AgentExecution | undefined;
}

export interface SessionInitializer {
  initialize(session: SessionSnapshot): Promise<SessionSnapshot>;
}

export interface AgentForkRequest {
  readonly sourceSessionId: SessionId;
  readonly targetSessionId?: SessionId;
  readonly throughVersion?: number;
  readonly metadata?: import("./json.js").JsonObject;
}
