import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { renameSettings } from "./rename-settings.js";
import { basename, dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Document, parseDocument } from "yaml";
import {
  SettingsConflictError,
  settingsServiceToken,
  type JsonObject,
  type SealHarnessEvents,
  type SettingsDescriptor,
  type SettingsRegistration,
  type SettingsPathOp,
  type SettingsScope,
  type SettingsService,
} from "@seal-harness/core";
import { definePlugin, type PluginContext } from "@seal-harness/kernel";

export interface FileSettingsConfig { readonly path: string; readonly watch?: boolean; readonly debounceMs?: number; readonly lockWaitMs?: number }
interface Registration {
  readonly namespace: string; readonly base: JsonObject; readonly applies: "live" | "restart";
  readonly validate?: (value: JsonObject) => JsonObject; readonly listeners: Set<(next: SettingsDescriptor, previous: SettingsDescriptor) => void | Promise<void>>;
  readonly secretPaths: (value: JsonObject) => readonly (readonly string[])[];
  readonly schema?: JsonObject;
  revision: number; value: JsonObject;
}

export class FileSettingsService implements SettingsService {
  readonly writable = true;
  readonly documentPath: string;
  readonly #format: "json" | "yaml";
  readonly #registrations = new Map<string, Registration>();
  readonly #scopes = new Map<string, SettingsScope>();
  #document: Record<string, JsonObject> = {};
  #queue: Promise<unknown> = Promise.resolve();
  #text: string | undefined;
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #watchClosed = false;

  private constructor(path: string, readonly emit: PluginContext<SealHarnessEvents>["emit"], readonly lockWaitMs = 2_000) { this.documentPath = resolve(path); const extension = extname(this.documentPath).toLowerCase(); if (extension !== ".json" && extension !== ".yaml" && extension !== ".yml") throw new TypeError("settings path must end in .json, .yaml, or .yml"); this.#format = extension === ".json" ? "json" : "yaml"; }
  static async open(path: string, emit: PluginContext<SealHarnessEvents>["emit"] = async () => {}, lockWaitMs = 2_000): Promise<FileSettingsService> {
    if (!Number.isFinite(lockWaitMs) || lockWaitMs < 0) throw new TypeError("settings lockWaitMs must be non-negative");
    const service = new FileSettingsService(path, emit, lockWaitMs); await service.#load(); return service;
  }

  register<T extends JsonObject>(namespace: string, options: SettingsRegistration<T> = {}): SettingsScope<T> {
    if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw new TypeError(`Settings namespace must match /^[a-z][a-z0-9-]*$/: ${namespace}`);
    if (this.#registrations.has(namespace)) throw new Error(`Settings namespace is already registered: ${namespace}`);
    const base = clone(options.base ?? {}); const user = this.#document[namespace];
    const validate = options.validate as ((value: JsonObject) => JsonObject) | undefined;
    const value = validateValue(validate, merge(base, user ?? {}));
    const specifiedSecretPaths = options.secretPaths;
    const secretPaths = typeof specifiedSecretPaths === "function" ? specifiedSecretPaths as (value: JsonObject) => readonly (readonly string[])[] : () => specifiedSecretPaths?.map((path) => [...path]) ?? [];
    const registration: Registration = { namespace, base, applies: options.applies ?? "live", ...(validate === undefined ? {} : { validate }), ...(options.schema === undefined ? {} : { schema: checked(options.schema) }), secretPaths, listeners: new Set(), revision: 0, value };
    this.#registrations.set(namespace, registration);
    const get = () => descriptor(registration, this.#document[namespace]);
    const scope: SettingsScope<T> = {
      get: get as () => SettingsDescriptor<T>,
      update: async (patch, expected) => this.#write(registration, "update", checked(patch), expected) as Promise<SettingsDescriptor<T>>,
      replace: async (next, expected) => this.#write(registration, "replace", checked(next), expected) as Promise<SettingsDescriptor<T>>,
      mutate: async (ops, expected) => this.#write(registration, "mutate", checkedOps(ops), expected) as Promise<SettingsDescriptor<T>>,
      watch: (listener) => { const cast = listener as (next: SettingsDescriptor, previous: SettingsDescriptor) => void | Promise<void>; registration.listeners.add(cast); return () => registration.listeners.delete(cast); },
      dispose: () => { if (this.#registrations.get(namespace) !== registration) return; registration.listeners.clear(); this.#registrations.delete(namespace); this.#scopes.delete(namespace); },
    };
    this.#scopes.set(namespace, scope);
    return scope;
  }

  scope(namespace: string): SettingsScope | undefined { return this.#scopes.get(namespace); }

  describe(options: { readonly redactSecrets?: boolean } = {}): readonly SettingsDescriptor[] { return [...this.#registrations.values()].map((entry) => options.redactSecrets ? redactedDescriptor(entry, this.#document[entry.namespace]) : descriptor(entry, this.#document[entry.namespace])); }

  async prepareDocument(): Promise<string> {
    const task = this.#queue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.documentPath), { recursive: true, mode: 0o700 });
      await withFileLock(this.documentPath, this.lockWaitMs, async () => {
        await this.#reconcileFromDisk();
        if (this.#text !== undefined) return;
        const rendered = this.#format === "json" ? `${JSON.stringify(this.#document, null, 2)}\n` : new Document(this.#document).toString();
        await atomicWrite(this.documentPath, rendered);
        this.#text = rendered;
      });
      return this.documentPath;
    });
    this.#queue = task;
    return task;
  }

  startWatching(debounceMs = 100): () => Promise<void> {
    if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new TypeError("settings debounceMs must be non-negative");
    if (this.#watcher !== undefined) throw new Error("settings watcher is already active");
    this.#watchClosed = false;
    const directory = dirname(this.documentPath);
    void mkdir(directory, { recursive: true, mode: 0o700 }).then(() => {
      if (this.#watcher !== undefined || this.#watchClosed) return;
      this.#watcher = watch(directory, (_event, filename) => {
        if (filename?.toString() !== basename(this.documentPath)) return;
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => { void this.#refresh(); }, debounceMs);
      });
    });
    return async () => { this.#watchClosed = true; if (this.#timer !== undefined) clearTimeout(this.#timer); this.#watcher?.close(); this.#watcher = undefined; await this.#queue.catch(() => {}); };
  }

  async #load(): Promise<void> {
    let text: string; try { text = await readFile(this.documentPath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const parsed: unknown = this.#parse(text);
    if (!plain(parsed)) throw new TypeError("Settings document must be a JSON object");
    for (const [key, value] of Object.entries(parsed)) { if (!plain(value)) throw new TypeError(`Settings namespace ${key} must be a JSON object`); this.#document[key] = checked(value); }
    this.#text = text;
  }

  #write(registration: Registration, mode: "update" | "replace" | "mutate", input: JsonObject | readonly SettingsPathOp[], expected?: number): Promise<SettingsDescriptor> {
    const task = this.#queue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.documentPath), { recursive: true, mode: 0o700 });
      return withFileLock(this.documentPath, this.lockWaitMs, async () => {
        await this.#reconcileFromDisk();
        if (expected !== undefined && expected !== registration.revision) throw new SettingsConflictError(registration.namespace, expected, registration.revision);
        const current = this.#document[registration.namespace] ?? {};
        const section = mode === "update" ? merge(current, input as JsonObject) : mode === "replace" ? input as JsonObject : applyPathOps(current, input as readonly SettingsPathOp[]);
        const nextValue = validateValue(registration.validate, merge(registration.base, section));
        const previous = descriptor(registration, this.#document[registration.namespace]);
        if (JSON.stringify(current) === JSON.stringify(section)) return previous;
        const document = { ...this.#document, [registration.namespace]: clone(section) };
        const rendered = this.#render(registration.namespace, this.#document[registration.namespace], section, document);
        await atomicWrite(this.documentPath, rendered); this.#text = rendered;
        this.#document = document; registration.value = nextValue; registration.revision += 1;
        const next = descriptor(registration, section);
        await this.emit("settings.updated", { namespace: registration.namespace, revision: registration.revision, value: clone(next.value), previous: clone(previous.value), source: "update" });
        for (const listener of registration.listeners) { try { await listener(next, previous); } catch { /* observers cannot roll back a durable commit */ } }
        return next;
      });
    });
    this.#queue = task; return task;
  }

  async #refresh(): Promise<void> {
    const task = this.#queue.catch(() => {}).then(async () => {
      try { await this.#reconcileFromDisk(); } catch { /* hot reload keeps the last good document */ }
    });
    this.#queue = task; await task;
  }

  async #reconcileFromDisk(): Promise<void> {
    let text: string | undefined; try { text = await readFile(this.documentPath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (text === this.#text) return;
    const parsed: unknown = text === undefined ? {} : this.#parse(text);
    if (!plain(parsed)) throw new TypeError("Settings document must be a JSON object");
    const nextDocument: Record<string, JsonObject> = {}; for (const [key, value] of Object.entries(parsed)) nextDocument[key] = checked(value);
    for (const registration of this.#registrations.values()) {
      const previous = descriptor(registration, this.#document[registration.namespace]);
      const rawChanged = JSON.stringify(this.#document[registration.namespace]) !== JSON.stringify(nextDocument[registration.namespace]); if (!rawChanged) continue;
      let value: JsonObject; try { value = validateValue(registration.validate, merge(registration.base, nextDocument[registration.namespace] ?? {})); } catch { continue; }
      registration.value = value; registration.revision += 1; const next = descriptor(registration, nextDocument[registration.namespace]);
      await this.emit("settings.updated", { namespace: registration.namespace, revision: registration.revision, value: clone(next.value), previous: clone(previous.value), source: "provider" });
      for (const listener of registration.listeners) { try { await listener(next, previous); } catch {} }
    }
    this.#document = nextDocument; this.#text = text;
  }

  #parse(text: string): unknown {
    if (text.trim() === "") return {};
    if (this.#format === "json") return JSON.parse(text);
    const document = parseDocument(text, { prettyErrors: false });
    if (document.errors.length > 0) throw new Error(`settings-file: invalid YAML document (${document.errors.map((error) => error.code).join(", ")})`);
    return document.toJS() ?? {};
  }

  #render(namespace: string, previous: JsonObject | undefined, section: JsonObject, documentValue: Record<string, JsonObject>): string {
    if (this.#format === "json") return `${JSON.stringify(documentValue, null, 2)}\n`;
    const document = this.#text === undefined ? new Document({}) : parseDocument(this.#text);
    patchYaml(document, [namespace], previous, section);
    return document.toString();
  }
}

export const fileSettingsPlugin = definePlugin<FileSettingsConfig, SealHarnessEvents>({
  name: "settings-file", provides: [settingsServiceToken],
  async setup(context, config) { const service = await FileSettingsService.open(config.path, context.emit, config.lockWaitMs ?? 2_000); context.provide(settingsServiceToken, service); return config.watch === false ? undefined : service.startWatching(config.debounceMs ?? 100); },
});

function descriptor(entry: Registration, user?: JsonObject): SettingsDescriptor {
  return { namespace: entry.namespace, value: clone(entry.value), ...(user === undefined ? {} : { user: clone(user) }), base: clone(entry.base), revision: entry.revision, applies: entry.applies, ...(entry.schema === undefined ? {} : { schema: clone(entry.schema) }) };
}
function redactedDescriptor(entry: Registration, user?: JsonObject): SettingsDescriptor { const value = clone(entry.value); const base = clone(entry.base); const raw = user === undefined ? undefined : clone(user); const paths = entry.secretPaths(entry.value).map((path) => [...path]); const secrets = paths.map((path) => ({ path, set: readPath(value, path) !== undefined })); for (const path of paths) { unsetPath(value, path); unsetPath(base, path); if (raw !== undefined) unsetPath(raw, path); } return { namespace: entry.namespace, value, ...(raw === undefined ? {} : { user: raw }), base, revision: entry.revision, applies: entry.applies, secrets, ...(entry.schema === undefined ? {} : { schema: clone(entry.schema) }) }; }
function readPath(root: JsonObject, path: readonly string[]): unknown { let current: unknown = root; for (const key of path) { if (Array.isArray(current)) current = current[Number(key)]; else if (plain(current)) current = current[key]; else return undefined; } return current; }
function unsetPath(root: JsonObject, path: readonly string[]): void { if (path.length === 0) return; let current: unknown = root; for (const key of path.slice(0, -1)) { if (Array.isArray(current)) current = current[Number(key)]; else if (plain(current)) current = current[key]; else return; } const key = path.at(-1)!; if (Array.isArray(current)) delete current[Number(key)]; else if (plain(current)) delete current[key]; }
function validateValue(validate: ((value: JsonObject) => JsonObject) | undefined, value: JsonObject): JsonObject { return clone(validate?.(clone(value)) ?? value); }
function plain(value: unknown): value is Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) return false; const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null; }
function checked(value: unknown): JsonObject {
  const visiting = new WeakSet<object>();
  const copy = (entry: unknown, path: string, inArray: boolean): unknown => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (entry === undefined && !inArray) return undefined;
    if (typeof entry !== "object" || entry === null || (!Array.isArray(entry) && !plain(entry))) throw new TypeError(`Settings value must be JSON-compatible at ${path}`);
    if (visiting.has(entry)) throw new TypeError(`Settings value contains a cycle at ${path}`);
    visiting.add(entry);
    const result = Array.isArray(entry)
      ? entry.map((item, index) => copy(item, `${path}[${index}]`, true))
      : Object.fromEntries(Object.entries(entry).flatMap(([key, item]) => { const next = copy(item, `${path}.${key}`, false); return next === undefined ? [] : [[key, next]]; }));
    visiting.delete(entry); return result;
  };
  if (!plain(value)) throw new TypeError("Settings value must be a plain JSON object");
  return copy(value, "$", false) as JsonObject;
}
function checkedOps(value: unknown): readonly SettingsPathOp[] {
  if (!Array.isArray(value)) throw new TypeError("Settings mutate operations must be an array");
  return value.map((candidate, index) => {
    if (!plain(candidate) || (candidate.op !== "set" && candidate.op !== "unset")) throw new TypeError(`Settings mutate operation ${index} must use set or unset`);
    if (!Array.isArray(candidate.path) || candidate.path.some((part) => typeof part !== "string")) throw new TypeError(`Settings mutate operation ${index} path must contain only strings`);
    const path = [...candidate.path] as string[];
    if (candidate.op === "unset") return { op: "unset", path };
    if (!("value" in candidate)) throw new TypeError(`Settings mutate operation ${index} set requires a value`);
    const envelope = checked({ value: candidate.value });
    if (!("value" in envelope)) throw new TypeError(`Settings value must be JSON-compatible at operation ${index}`);
    return { op: "set", path, value: envelope.value } as SettingsPathOp;
  });
}
function applyPathOps(section: JsonObject, ops: readonly SettingsPathOp[]): JsonObject {
  let root: unknown = clone(section);
  for (const operation of ops) {
    if (operation.path.length === 0) {
      if (operation.op === "unset") root = {};
      else if (plain(operation.value)) root = clone(operation.value);
      else throw new TypeError("Settings root must remain a JSON object");
      continue;
    }
    const parentPath = operation.path.slice(0, -1);
    let current: unknown = root;
    for (let index = 0; index < parentPath.length; index += 1) {
      const key = parentPath[index]!;
      const nextKey = operation.path[index + 1]!;
      if (Array.isArray(current)) {
        const position = arrayIndex(key);
        const child = current[position];
        if (!plain(child) && !Array.isArray(child)) current[position] = /^\d+$/.test(nextKey) ? [] : {};
        current = current[position];
      } else if (plain(current)) {
        const child = current[key];
        if (!plain(child) && !Array.isArray(child)) current[key] = /^\d+$/.test(nextKey) ? [] : {};
        current = current[key];
      } else throw new TypeError(`Settings mutate path cannot traverse ${operation.path.slice(0, index).join(".")}`);
    }
    const key = operation.path.at(-1)!;
    if (Array.isArray(current)) {
      const position = arrayIndex(key);
      if (operation.op === "unset") current.splice(position, 1); else current[position] = clone(operation.value);
    } else if (plain(current)) {
      if (operation.op === "unset") delete current[key]; else current[key] = clone(operation.value);
    } else throw new TypeError(`Settings mutate path cannot traverse ${parentPath.join(".")}`);
  }
  return checked(root);
}
function arrayIndex(value: string): number { const parsed = Number(value); if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) throw new TypeError(`Settings array path segment must be a non-negative integer: ${value}`); return parsed; }
function clone<T>(value: T): T { return structuredClone(value); }
function merge(lower: JsonObject, upper: JsonObject): JsonObject { const output = Object.fromEntries(Object.entries(clone(lower))) as Record<string, unknown>; for (const [key, value] of Object.entries(upper)) Object.defineProperty(output, key, { value: plain(output[key]) && plain(value) ? merge(output[key] as JsonObject, value as JsonObject) : clone(value), enumerable: true, configurable: true, writable: true }); return output as JsonObject; }
async function atomicWrite(path: string, text: string): Promise<void> { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.tmp-${randomUUID()}`; const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(text, "utf8"); await handle.sync(); await handle.close(); await renameSettings(temporary, path); } catch (error) { await handle.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); throw error; } }
async function withFileLock<T>(path: string, waitMs: number, operation: () => Promise<T>): Promise<T> { const lock = `${path}.lock`; const deadline = Date.now() + waitMs; let delay = 20; for (;;) { try { await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); break; } catch (error) { const code = (error as NodeJS.ErrnoException).code; let contention = code === "EEXIST"; if (!contention && code === "EPERM") { try { await lstat(lock); contention = true; } catch {} } if (!contention) throw error; if (Date.now() >= deadline) throw new Error(`settings-file: timed out waiting for the writer lock at ${lock}`); await new Promise((resolvePromise) => setTimeout(resolvePromise, delay)); delay = Math.min(delay * 2, 200); } } try { return await operation(); } finally { await rm(lock, { force: true }); } }
function patchYaml(document: Document, path: readonly string[], previous: unknown, next: unknown): void { if (plain(previous) && plain(next)) { for (const key of Object.keys(previous)) if (!(key in next)) document.deleteIn([...path, key]); for (const [key, value] of Object.entries(next)) patchYaml(document, [...path, key], previous[key], value); return; } if (JSON.stringify(previous) !== JSON.stringify(next)) document.setIn([...path], next); }
