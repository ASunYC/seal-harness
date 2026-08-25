import type { AgentMessage } from "./content.js";
import type { SessionId } from "./ids.js";

export interface CompactionRequest {
  readonly sessionId: SessionId;
  readonly messages: readonly AgentMessage[];
  readonly signal: AbortSignal;
}

export interface CompactionResult {
  readonly summaryMessage: AgentMessage;
  readonly retainedMessages: readonly AgentMessage[];
}

export interface CompactionService {
  compact(request: CompactionRequest): Promise<CompactionResult | undefined>;
}
