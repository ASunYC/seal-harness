import type { AgentMessage, ContentBlock } from "./content.js";
import type { SessionId } from "./ids.js";

export interface ContextRequest {
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly prompt: readonly ContentBlock[];
  readonly history: readonly AgentMessage[];
  readonly signal: AbortSignal;
}

export interface PreparedContext {
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
}

export interface ContextService {
  prepare(request: ContextRequest): Promise<PreparedContext>;
}
