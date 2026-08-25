import type { EventMap, PluginDefinition, PluginSpec } from "./types.js";

export function definePlugin<
  TConfig = undefined,
  TEvents extends EventMap = EventMap,
>(definition: PluginDefinition<TConfig, TEvents>): PluginDefinition<TConfig, TEvents> {
  return definition;
}

export function plugin<
  TConfig,
  TEvents extends EventMap = EventMap,
>(
  definition: PluginDefinition<TConfig, TEvents>,
  config: TConfig,
  options: { id?: string; enabled?: boolean } = {},
): PluginSpec<TConfig, TEvents> {
  return {
    ...options,
    plugin: definition,
    config,
  };
}
