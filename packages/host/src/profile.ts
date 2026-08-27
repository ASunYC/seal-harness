import type { AnyPluginSpec, EventMap } from "@seal-harness/kernel";

export type Profile<TEvents extends EventMap = EventMap> = readonly AnyPluginSpec<TEvents>[];

export function defineProfile<TEvents extends EventMap = EventMap>(
  specs: readonly AnyPluginSpec<TEvents>[],
): Profile<TEvents> {
  return Object.freeze([...specs]);
}

export function assertProfile<TEvents extends EventMap = EventMap>(
  value: unknown,
  configPath?: string,
): asserts value is Profile<TEvents> {
  if (!Array.isArray(value)) {
    throw invalid("Profile default export must be an array", configPath);
  }

  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) {
      throw invalid(`Profile item ${index} must be an object`, configPath);
    }

    const candidate = item as Record<string, unknown>;
    const definition = candidate.plugin;
    if (typeof definition !== "object" || definition === null) {
      throw invalid(`Profile item ${index} is missing plugin`, configPath);
    }

    const plugin = definition as Record<string, unknown>;
    if (typeof plugin.name !== "string" || plugin.name.trim().length === 0) {
      throw invalid(`Profile item ${index} has an invalid plugin name`, configPath);
    }
    if (typeof plugin.setup !== "function") {
      throw invalid(`Profile item ${index} plugin is missing setup()`, configPath);
    }

    if (candidate.id !== undefined && typeof candidate.id !== "string") {
      throw invalid(`Profile item ${index} has a non-string id`, configPath);
    }
    if (candidate.enabled !== undefined && typeof candidate.enabled !== "boolean") {
      throw invalid(`Profile item ${index} has a non-boolean enabled value`, configPath);
    }
    if (!("config" in candidate)) {
      throw invalid(`Profile item ${index} is missing config`, configPath);
    }

    const instanceId = ((candidate.id as string | undefined) ?? plugin.name).trim();
    if (instanceId.length === 0) {
      throw invalid(`Profile item ${index} has an empty instance id`, configPath);
    }
    if (candidate.enabled !== false && ids.has(instanceId)) {
      throw invalid(`Profile contains duplicate enabled instance id: ${instanceId}`, configPath);
    }
    if (candidate.enabled !== false) ids.add(instanceId);
  }
}

function invalid(message: string, configPath?: string): Error {
  const error = new Error(configPath === undefined ? message : `${message}: ${configPath}`);
  error.name = "InvalidProfileError";
  return error;
}
