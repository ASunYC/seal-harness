import type { SessionId } from "./ids.js";
import type { SessionSnapshot } from "./session.js";
import type { ToolRestriction } from "./tool.js";

export interface AgentPresetSpec { readonly name?: string; readonly description?: string; readonly systemPrompt?: string; readonly tools?: ToolRestriction }
export interface AgentPresetRow { readonly id: string; readonly name: string; readonly description?: string; readonly isDefault: boolean; readonly broken?: string }
export interface AgentPresetAuthority {
  /** Resolve a preset owned by another composed runtime. */
  resolve(preset: string): Promise<AgentPresetRow | undefined>;
  /** Prepare that runtime's per-session preset scope before prompt context is collected. */
  prepare(session: SessionSnapshot, preset: string): Promise<void>;
}
export interface AgentPresetService {
  readonly defaultPreset: string;
  list(): readonly AgentPresetRow[];
  /** Validate that a preset exists and its tool restrictions can be installed without retaining state. */
  validate(preset: string): void | Promise<void>;
  /** Add an external preset authority without replacing Profile-owned presets. */
  registerAuthority?(authority: AgentPresetAuthority): () => void;
  current(sessionId: SessionId): Promise<string>;
  set(sessionId: SessionId, preset: string): Promise<string>;
  initialize(session: SessionSnapshot): Promise<SessionSnapshot>;
  systemPrompt(sessionId: SessionId): string | undefined;
}
