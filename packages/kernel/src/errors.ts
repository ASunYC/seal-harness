import type { ServiceToken } from "./token.js";

export class KernelStateError extends Error {
  override readonly name = "KernelStateError";
}

export class DuplicatePluginIdError extends Error {
  override readonly name = "DuplicatePluginIdError";

  constructor(readonly pluginId: string) {
    super(`Duplicate plugin instance id: ${pluginId}`);
  }
}

export class MissingServiceError extends Error {
  override readonly name = "MissingServiceError";

  constructor(
    readonly token: ServiceToken<unknown>,
    readonly consumerId?: string,
  ) {
    super(
      consumerId === undefined
        ? `Service is not available: ${token.name}`
        : `Plugin ${consumerId} requires missing service: ${token.name}`,
    );
  }
}

export class DuplicateServiceProviderError extends Error {
  override readonly name = "DuplicateServiceProviderError";

  constructor(
    readonly token: ServiceToken<unknown>,
    readonly firstProviderId: string,
    readonly secondProviderId: string,
  ) {
    super(
      `Service ${token.name} has multiple providers: ${firstProviderId}, ${secondProviderId}`,
    );
  }
}

export class CircularPluginDependencyError extends Error {
  override readonly name = "CircularPluginDependencyError";

  constructor(readonly pluginIds: readonly string[]) {
    super(`Circular plugin dependency: ${pluginIds.join(" -> ")}`);
  }
}

export class UndeclaredServiceError extends Error {
  override readonly name = "UndeclaredServiceError";

  constructor(
    readonly pluginId: string,
    readonly token: ServiceToken<unknown>,
  ) {
    super(`Plugin ${pluginId} tried to provide undeclared service: ${token.name}`);
  }
}

export class MissingProvidedServiceError extends Error {
  override readonly name = "MissingProvidedServiceError";

  constructor(
    readonly pluginId: string,
    readonly token: ServiceToken<unknown>,
  ) {
    super(`Plugin ${pluginId} did not provide declared service: ${token.name}`);
  }
}

export class PluginStartError extends Error {
  override readonly name = "PluginStartError";

  constructor(
    readonly pluginId: string,
    options: ErrorOptions,
  ) {
    super(`Plugin failed to start: ${pluginId}`, options);
  }
}
