import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  credentialServiceToken,
  type CredentialRequest,
  type CredentialChange,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialService,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface EnvironmentCredentialConfig {
  /** Keys use `provider.name`, for example `deepseek.apiKey`. */
  readonly variables?: Readonly<Record<string, string>>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Optional owner-local JSON document used below inherited environment values. */
  readonly path?: string;
  readonly lockWaitMs?: number;
  readonly watch?: boolean;
  readonly debounceMs?: number;
}

export class EnvironmentCredentialService implements CredentialService {
  readonly #stored = new Map<string, string>();
  readonly #records = new Map<string, CredentialRecord>();
  readonly #listeners = new Set<(change: CredentialChange) => void>();
  #writes: Promise<void> = Promise.resolve();
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #watchClosed = false;
  constructor(readonly config: EnvironmentCredentialConfig = {}) {}

  async initialize(): Promise<void> {
    if (this.config.path === undefined) return;
    await this.reload();
  }

  private async reload(): Promise<void> {
    const path = this.config.path;
    if (path === undefined) return;
    const nextStored = new Map<string, string>(); const nextRecords = new Map<string, CredentialRecord>();
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!record(parsed)) throw new Error("credential document must be an object");
      const refs = parsed.version === 1 ? parsed.refs : parsed;
      const records = parsed.version === 1 ? parsed.records : {};
      if (!record(refs) || !record(records)) throw new Error("credential document sections must be objects");
      for (const [key, value] of Object.entries(refs)) {
        if (!validReference(key) || typeof value !== "string" || value.length === 0) throw new Error(`invalid credential entry: ${key}`);
        nextStored.set(key, value);
      }
      for (const [key, value] of Object.entries(records)) nextRecords.set(validateRecordKey(key), validateRecord(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const previous = new Map(this.#stored); const previousRecords = new Map(this.#records);
    this.#stored.clear(); for (const entry of nextStored) this.#stored.set(...entry);
    this.#records.clear(); for (const entry of nextRecords) this.#records.set(...entry);
    this.publishDifferences(previous, previousRecords);
  }

  subscribe(listener: (change: CredentialChange) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  startWatching(debounceMs = this.config.debounceMs ?? 100): () => Promise<void> {
    const path = this.config.path; if (path === undefined) return async () => {};
    if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new Error("credential debounceMs must be non-negative");
    this.#watchClosed = false;
    void mkdir(dirname(path), { recursive: true, mode: 0o700 }).then(() => {
      if (this.#watcher !== undefined || this.#watchClosed) return;
      this.#watcher = watch(dirname(path), (_event, filename) => {
        if (filename?.toString() !== basename(path)) return;
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => { void this.refresh(); }, debounceMs);
      });
    });
    return async () => { this.#watchClosed = true; if (this.#timer !== undefined) clearTimeout(this.#timer); this.#watcher?.close(); this.#watcher = undefined; await this.#writes; this.#listeners.clear(); };
  }

  private async refresh(): Promise<void> {
    const task = this.#writes.then(() => this.reload().catch(() => {})); this.#writes = task; await task;
  }

  async resolve(request: CredentialRequest): Promise<string | undefined> {
    request.signal?.throwIfAborted();
    const key = `${request.provider}.${request.name}`;
    const variable = this.config.variables?.[key] ?? defaultVariable(request);
    return this.resolveRef(variable, request.signal);
  }

  async resolveRef(reference: string, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted();
    validateReference(reference);
    const value = this.inherited(reference) ?? this.#stored.get(reference);
    return value === undefined || value.length === 0 ? undefined : value;
  }

  async describeRef(reference: string): Promise<{ configured: boolean; source?: string; writable: boolean }> {
    validateReference(reference);
    const inherited = this.inherited(reference);
    if (inherited !== undefined) return { configured: true, source: "env", writable: false };
    return { configured: this.#stored.has(reference), ...(this.#stored.has(reference) ? { source: "file" } : {}), writable: this.config.path !== undefined };
  }

  async setRef(reference: string, value: string): Promise<void> {
    validateReference(reference);
    if (value.length === 0) throw new Error("an empty credential cannot be stored; use unsetRef");
    this.assertWritable(reference);
    await this.mutate(() => { this.#stored.set(reference, value); });
  }

  async unsetRef(reference: string): Promise<void> {
    validateReference(reference);
    this.assertWritable(reference);
    await this.mutate(() => { this.#stored.delete(reference); });
  }

  async readRecord(key: string): Promise<CredentialRecord | undefined> {
    validateRecordKey(key); const value = this.#records.get(key); return value === undefined ? undefined : structuredClone(value);
  }

  async describeRecord(key: string): Promise<{ configured: boolean; kind?: CredentialRecord["kind"]; writable: boolean }> {
    validateRecordKey(key); const value = this.#records.get(key);
    return { configured: value !== undefined, ...(value === undefined ? {} : { kind: value.kind }), writable: this.config.path !== undefined };
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return [...this.#records].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, kind: value.kind }));
  }

  async modifyRecord(key: string, change: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    validateRecordKey(key); this.assertRecordWritable();
    return this.mutate(async () => {
      const current = this.#records.get(key); const next = await change(current === undefined ? undefined : structuredClone(current));
      if (next === undefined) return current === undefined ? undefined : structuredClone(current);
      const validated = validateRecord(next); this.#records.set(key, validated); return structuredClone(validated);
    });
  }

  async deleteRecord(key: string): Promise<void> {
    validateRecordKey(key); this.assertRecordWritable(); await this.mutate(() => { this.#records.delete(key); });
  }

  private inherited(reference: string): string | undefined {
    const value = this.config.environment?.[reference] ?? process.env[reference];
    return value === undefined || value.length === 0 ? undefined : value;
  }

  private assertWritable(reference: string): void {
    if (this.config.path === undefined) throw new Error("credential provider is read-only without a configured path");
    if (this.inherited(reference) !== undefined) throw new Error(`credential ${reference} is supplied by the launching environment and cannot be overwritten`);
  }

  private assertRecordWritable(): void { if (this.config.path === undefined) throw new Error("credential provider is read-only without a configured path"); }

  private mutate<T>(change: () => T | Promise<T>): Promise<T> {
    const task = this.#writes.then(async () => {
      const path = this.config.path!; await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      return withFileLock(path, this.config.lockWaitMs ?? 2_000, async () => {
        await this.reload();
        const previous = new Map(this.#stored); const previousRecords = new Map(this.#records);
        try { const result = await change(); await this.persist(); this.publishDifferences(previous, previousRecords); return result; }
        catch (error) {
          this.#stored.clear(); for (const entry of previous) this.#stored.set(...entry);
          this.#records.clear(); for (const entry of previousRecords) this.#records.set(...entry);
          throw error;
        }
      });
    });
    this.#writes = task.then(() => undefined, () => undefined);
    return task;
  }

  private async persist(): Promise<void> {
    const path = this.config.path!; await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const document = { version: 1, refs: Object.fromEntries([...this.#stored].sort()), records: Object.fromEntries([...this.#records].sort()) };
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }

  private publishDifferences(previous: ReadonlyMap<string, string>, previousRecords: ReadonlyMap<string, CredentialRecord>): void {
    for (const key of union(previous.keys(), this.#stored.keys())) if (previous.get(key) !== this.#stored.get(key)) this.publish({ kind: "reference", reference: key });
    for (const key of union(previousRecords.keys(), this.#records.keys())) if (JSON.stringify(previousRecords.get(key)) !== JSON.stringify(this.#records.get(key))) this.publish({ kind: "record", key });
  }

  private publish(change: CredentialChange): void { for (const listener of this.#listeners) { try { listener(change); } catch {} } }
}

export const environmentCredentialPlugin = definePlugin<EnvironmentCredentialConfig, SealHarnessEvents>({
  name: "credentials-env",
  provides: [credentialServiceToken],
  async setup(context, config) {
    const service = new EnvironmentCredentialService(config);
    await service.initialize();
    context.provide(credentialServiceToken, service);
    return config.watch === false ? undefined : service.startWatching();
  },
});

function defaultVariable(request: CredentialRequest): string {
  const provider = request.provider.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  const name = request.name.replaceAll(/([a-z])([A-Z])/g, "$1_$2").replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return `${provider}_${name}`;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validReference(value: string): boolean { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value); }
function validateReference(value: string): void { if (!validReference(value)) throw new Error(`invalid environment-style credential reference: ${value}`); }
function validateRecordKey(value: string): string {
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) throw new Error(`credential record key must be <scope>/<id>: ${value}`);
  return value;
}
function validateRecord(value: unknown): CredentialRecord {
  if (!record(value)) throw new Error("credential record must be an object");
  if (value.kind === "api-key") {
    if (value.key !== undefined && (typeof value.key !== "string" || value.key.length === 0)) throw new Error("api-key record key must be non-empty");
    if (value.env !== undefined && (!record(value.env) || Object.entries(value.env).some(([key, entry]) => !validReference(key) || typeof entry !== "string"))) throw new Error("api-key record env is invalid");
    return { kind: "api-key", ...(value.key === undefined ? {} : { key: value.key }), ...(value.env === undefined ? {} : { env: value.env as Record<string, string> }) };
  }
  if (value.kind === "grant" && "payload" in value) {
    try { return { kind: "grant", payload: JSON.parse(JSON.stringify(value.payload)) }; }
    catch { throw new Error("grant payload must be JSON-compatible"); }
  }
  throw new Error("credential record kind is invalid");
}
async function withFileLock<T>(path: string, waitMs: number, operation: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error("credential lockWaitMs must be non-negative");
  const lock = `${path}.lock`; const deadline = Date.now() + waitMs; let delay = 20;
  for (;;) {
    try { await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); break; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code; let contention = code === "EEXIST";
      if (!contention && code === "EPERM") { try { await lstat(lock); contention = true; } catch {} }
      if (!contention) throw error;
      if (Date.now() >= deadline) throw new Error(`credentials: timed out waiting for writer lock at ${lock}`);
      await new Promise((resolve) => setTimeout(resolve, delay)); delay = Math.min(delay * 2, 200);
    }
  }
  try { return await operation(); } finally { await rm(lock, { force: true }); }
}
function union<T>(left: Iterable<T>, right: Iterable<T>): Set<T> { return new Set([...left, ...right]); }
