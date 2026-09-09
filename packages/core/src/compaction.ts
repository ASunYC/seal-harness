import type { AgentMessage } from "./content.js";
import type { SessionId } from "./ids.js";
import type { ModelRef } from "./model.js";

export interface CompactionRequest {
  readonly sessionId: SessionId;
  readonly messages: readonly AgentMessage[];
  readonly model: ModelRef;
  readonly signal: AbortSignal;
}

export interface CompactionResult {
  readonly summaryMessage: AgentMessage;
  readonly retainedMessages: readonly AgentMessage[];
}

export interface CompactionService {
  compact(request: CompactionRequest): Promise<CompactionResult | undefined>;
}
