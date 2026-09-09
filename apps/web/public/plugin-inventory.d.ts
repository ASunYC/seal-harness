export interface PluginInventoryEntry { readonly entryId?: string; readonly moduleName?: string; readonly fiberPhase?: string; readonly enabled?: boolean }
export interface PluginInventoryPreset<T extends PluginInventoryEntry = PluginInventoryEntry> { readonly id?: string; readonly isDefault?: boolean; readonly rows: readonly T[] }
export function orderPluginInventoryEntries<T extends PluginInventoryEntry>(entries: readonly T[]): T[];
export function filterPluginInventory<T extends PluginInventoryEntry, P extends PluginInventoryPreset<T>>(snapshot: { readonly entries?: readonly T[]; readonly agentPresets?: readonly P[] }, query: string): { entries: T[]; agentPresets: Array<P & { rows: T[] }> };
export function defaultPluginInventoryPreset<T extends PluginInventoryPreset>(presets: readonly T[], chosenId?: string | null): T | undefined;
export function shortPluginModuleName(moduleName: string): string;
export function enabledPluginPresets<T extends PluginInventoryPreset>(presets: readonly T[]): Map<string | undefined, T[]>;
