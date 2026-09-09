import type { JsonObject, JsonValue } from "./json.js";

export type SettingsApplies = "live" | "restart";

export type SettingsPathOp =
  | { readonly op: "set"; readonly path: readonly string[]; readonly value: JsonValue }
  | { readonly op: "unset"; readonly path: readonly string[] };

export interface SettingsDescriptor<T extends JsonObject = JsonObject> {
  readonly namespace: string;
  readonly value: T;
  readonly user?: JsonObject;
  readonly base: JsonObject;
  readonly revision: number;
  readonly applies: SettingsApplies;
  readonly secrets?: readonly { readonly path: readonly string[]; readonly set: boolean }[];
  readonly schema?: JsonObject;
}

export interface SettingsScope<T extends JsonObject = JsonObject> {
  get(): SettingsDescriptor<T>;
  update(patch: JsonObject, expectedRevision?: number): Promise<SettingsDescriptor<T>>;
  replace(value: JsonObject, expectedRevision?: number): Promise<SettingsDescriptor<T>>;
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<SettingsDescriptor<T>>;
  watch(listener: (next: SettingsDescriptor<T>, previous: SettingsDescriptor<T>) => void | Promise<void>): () => void;
  /** Remove this namespace registration and all of its listeners. Idempotent. */
  dispose(): void;
}

export interface SettingsRegistration<T extends JsonObject = JsonObject> {
  readonly base?: JsonObject;
  readonly applies?: SettingsApplies;
  readonly validate?: (value: JsonObject) => T;
  /** Paths removed from redacted descriptions while retaining whether a value is set. */
  readonly secretPaths?: readonly (readonly string[])[] | ((value: T) => readonly (readonly string[])[]);
  /** JSON Schema used by configuration surfaces. */
  readonly schema?: JsonObject;
}

export interface SettingsService {
  readonly writable: boolean;
  readonly documentPath?: string;
  register<T extends JsonObject = JsonObject>(namespace: string, options?: SettingsRegistration<T>): SettingsScope<T>;
  scope(namespace: string): SettingsScope | undefined;
  describe(options?: { readonly redactSecrets?: boolean }): readonly SettingsDescriptor[];
  /** Materialize and return the provider-owned settings document when available. */
  prepareDocument?(): Promise<string | undefined>;
}

export class SettingsConflictError extends Error {
  override readonly name = "SettingsConflictError";
  readonly code = "SETTINGS_CONFLICT";
  constructor(readonly namespace: string, readonly expected: number, readonly actual: number) {
    super(`Settings namespace ${namespace} changed since it was read: expected ${expected}, actual ${actual}`);
  }
}
