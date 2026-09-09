export interface AgentPresetRow {
  readonly id: string;
  readonly trust?: string;
  readonly name?: string;
  readonly description?: string;
}
export const AGENT_PRESET_ID: RegExp;
export function agentPresetCopyIssue(id: string, presets: readonly AgentPresetRow[]): "required" | "invalid" | "taken" | null;
export function groupedAgentPresets<T extends AgentPresetRow>(presets: readonly T[]): { system: T[]; user: T[] };
export function agentPresetDisplayText(preset: AgentPresetRow, translate: (key: string) => string): { name: string; description?: string };
