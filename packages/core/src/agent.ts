import type { AgentMessage, ContentBlock } from "./content.js";
import type { RunId, SessionId } from "./ids.js";
import type { ModelRef } from "./model.js";
import type { AgentRun, RuntimeEvent, RuntimeResult } from "./runtime.js";
import type { SessionSnapshot } from "./session.js";

export interface AgentPromptRequest {
  readonly sessionId?: SessionId;
  readonly cwd: string;
  readonly model: ModelRef;
  readonly prompt: readonly ContentBlock[];
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  readonly signal?: AbortSignal;
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
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
}

export interface AgentService {
  prompt(request: AgentPromptRequest): Promise<AgentExecution>;
  fork(request: AgentForkRequest): Promise<SessionSnapshot>;
}

export interface AgentForkRequest {
  readonly sourceSessionId: SessionId;
  readonly targetSessionId?: SessionId;
  readonly throughVersion?: number;
}
