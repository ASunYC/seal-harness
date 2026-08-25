import {
  CircularPluginDependencyError,
  DuplicatePluginIdError,
  DuplicateServiceProviderError,
  MissingServiceError,
} from "./errors.js";
import type { ServiceToken } from "./token.js";
import type { AnyPluginSpec, EventMap } from "./types.js";

export interface ResolvedPlugin<TEvents extends EventMap> {
  readonly id: string;
  readonly index: number;
  readonly spec: AnyPluginSpec<TEvents>;
}

export function resolveProfile<TEvents extends EventMap>(
  specs: readonly AnyPluginSpec<TEvents>[],
  initialServices: readonly ServiceToken<unknown>[],
): ResolvedPlugin<TEvents>[] {
  const enabled = specs
    .map((spec, index) => ({
      id: normalizePluginId(spec.id ?? spec.plugin.name),
      index,
      spec,
    }))
    .filter(({ spec }) => spec.enabled !== false);

  const ids = new Set<string>();
  for (const item of enabled) {
    if (ids.has(item.id)) throw new DuplicatePluginIdError(item.id);
    ids.add(item.id);
  }

  const initial = new Set(initialServices.map((token) => token.id));
  const providerByToken = new Map<symbol, ResolvedPlugin<TEvents>>();
  for (const item of enabled) {
    for (const token of item.spec.plugin.provides ?? []) {
      if (initial.has(token.id)) {
        throw new DuplicateServiceProviderError(token, "$kernel", item.id);
      }
      const existing = providerByToken.get(token.id);
      if (existing !== undefined) {
        throw new DuplicateServiceProviderError(token, existing.id, item.id);
      }
      providerByToken.set(token.id, item);
    }
  }

  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const item of enabled) {
    const itemDependencies = new Set<string>();
    dependencies.set(item.id, itemDependencies);

    for (const token of item.spec.plugin.requires ?? []) {
      if (initial.has(token.id)) continue;
      const provider = providerByToken.get(token.id);
      if (provider === undefined) throw new MissingServiceError(token, item.id);
      itemDependencies.add(provider.id);
    }

    for (const token of item.spec.plugin.optional ?? []) {
      const provider = providerByToken.get(token.id);
      if (provider !== undefined) itemDependencies.add(provider.id);
    }

    for (const dependencyId of itemDependencies) {
      const downstream = dependents.get(dependencyId) ?? new Set<string>();
      downstream.add(item.id);
      dependents.set(dependencyId, downstream);
    }
  }

  const byId = new Map(enabled.map((item) => [item.id, item]));
  const ready = enabled
    .filter((item) => dependencies.get(item.id)?.size === 0)
    .sort((left, right) => left.index - right.index);
  const ordered: ResolvedPlugin<TEvents>[] = [];

  while (ready.length > 0) {
    const item = ready.shift();
    if (item === undefined) break;
    ordered.push(item);

    for (const dependentId of dependents.get(item.id) ?? []) {
      const remaining = dependencies.get(dependentId);
      remaining?.delete(item.id);
      if (remaining?.size === 0) {
        const dependent = byId.get(dependentId);
        if (dependent !== undefined) {
          ready.push(dependent);
          ready.sort((left, right) => left.index - right.index);
        }
      }
    }
  }

  if (ordered.length !== enabled.length) {
    const unresolved = enabled
      .filter((item) => !ordered.includes(item))
      .map((item) => item.id);
    throw new CircularPluginDependencyError(unresolved);
  }

  return ordered;
}

function normalizePluginId(id: string): string {
  const normalized = id.trim();
  if (normalized.length === 0) throw new TypeError("Plugin instance id must not be empty");
  return normalized;
}
