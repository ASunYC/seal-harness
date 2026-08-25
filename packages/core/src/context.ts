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
  /** New model-visible messages that must be persisted before the runtime starts. */
  readonly additions: readonly AgentMessage[];
}

export interface ContextContribution {
  readonly systemPrompt?: string;
  readonly additions?: readonly AgentMessage[];
}

export interface ContextSource {
  readonly name: string;
  contribute(request: ContextRequest): Promise<ContextContribution | undefined>;
}

export interface ContextService {
  register(source: ContextSource): () => void;
  prepare(request: ContextRequest): Promise<PreparedContext>;
}
