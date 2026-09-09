import { randomUUID } from "node:crypto";

export type RemoteEventDispatch =
  | { readonly event: string; readonly args: readonly unknown[] }
  | {
      readonly event: string;
      readonly request: Readonly<Record<string, unknown>>;
      readonly context: { readonly value: { effect?(callback: () => () => void, label?: string): unknown }; readonly subject: unknown };
      readonly resolve: (outcome: { kind: "next" } | { kind: "result"; value?: unknown }) => void;
      readonly reject: (reason: unknown) => void;
    };

export type RemoteEventSource = (signal: AbortSignal) => AsyncIterable<RemoteEventDispatch>;

interface Client {
  readonly id: string;
  readonly queue: EventQueue;
}
interface Pending {
  readonly id: string;
  readonly source: Extract<RemoteEventDispatch, { request: object }>;
  readonly clients: Set<string>;
  readonly cleanup: Array<() => void>;
  settled: boolean;
}

/** Host-side subset of TypertGateway that owns DSH Remote Event registration and settlement. */
export class DshRemoteEventGateway {
  readonly #clients = new Map<string, Client>();
  readonly #pending = new Map<string, Pending>();
  #registration: { abort: AbortController; done: Promise<void>; home: string } | undefined;

  registerRemoteEvents(source: RemoteEventSource, host: { readonly home: string }): () => Promise<void> {
    if (this.#registration !== undefined) throw new Error("typert gateway: forwarded Remote event source is already registered");
    const abort = new AbortController();
    const registration = { abort, home: host.home, done: Promise.resolve() };
    registration.done = this.#consume(source(abort.signal), abort.signal).catch((error) => {
      if (this.#registration === registration && !abort.signal.aborted) { this.#registration = undefined; this.#close(error); abort.abort(error); }
    });
    this.#registration = registration;
    return async () => {
      if (this.#registration === registration) { this.#registration = undefined; abort.abort(new Error("typert gateway: forwarded Remote event source was removed")); this.#close(abort.signal.reason); }
      await registration.done;
    };
  }

  hasRegistration(): boolean { return this.#registration !== undefined; }

  async *open(signal: AbortSignal, fallbackHome: string): AsyncGenerator<unknown> {
    const client: Client = { id: randomUUID(), queue: new EventQueue(signal) };
    this.#clients.set(client.id, client);
    for (const pending of this.#pending.values()) this.#deliver(pending, client);
    try {
      yield { type: "ready", clientId: client.id, host: { home: this.#registration?.home ?? fallbackHome } };
      yield* client.queue.iterate();
    } finally {
      this.#clients.delete(client.id);
      for (const pending of this.#pending.values()) {
        pending.clients.delete(client.id);
      }
    }
  }

  result(payload: unknown): { ok: true; value: undefined } | { ok: false; error: { code: string; message: string; details: object } } {
    const args = remoteArgs(payload); const clientId = args.clientId; const eventId = args.eventId; const outcome = args.outcome;
    if (typeof clientId !== "string" || typeof eventId !== "string" || outcome === null || typeof outcome !== "object" || Array.isArray(outcome)) return failure("gateway/arguments-invalid", "invalid Remote Event result");
    const pending = this.#pending.get(eventId); if (pending === undefined || !pending.clients.has(clientId)) return failure("gateway/arguments-invalid", "Remote Event result does not belong to this Client generation");
    const record = outcome as Record<string, unknown>;
    if (record.kind === "next" && Object.keys(record).length === 1) {
      pending.clients.delete(clientId); if (pending.clients.size === 0) this.#settle(pending, { kind: "next" }); return { ok: true, value: undefined };
    }
    if (record.kind === "result" && (Object.keys(record).length === 1 || (Object.keys(record).length === 2 && "value" in record))) {
      this.#settle(pending, { kind: "result", ...("value" in record ? { value: record.value } : {}) }); return { ok: true, value: undefined };
    }
    if (record.kind === "rejected" && record.error !== null && typeof record.error === "object") {
      const projected = record.error as { name?: unknown; message?: unknown; code?: unknown; details?: unknown };
      const error = Object.assign(new Error(typeof projected.message === "string" ? projected.message : "Remote Event listener rejected"), typeof projected.name === "string" ? { name: projected.name } : {}, typeof projected.code === "string" ? { code: projected.code } : {}, projected.details === undefined ? {} : { details: projected.details });
      this.#reject(pending, error); return { ok: true, value: undefined };
    }
    return failure("gateway/arguments-invalid", "invalid Remote Event outcome");
  }

  broadcast(event: string, args: readonly unknown[]): void {
    if (!event || !jsonSafe(args)) return;
    for (const client of this.#clients.values()) client.queue.push({ type: "emit", event, args });
  }

  close(): void { this.#registration?.abort.abort(new Error("typert gateway stopped")); this.#registration = undefined; this.#close(new Error("typert gateway stopped")); }

  async #consume(source: AsyncIterable<RemoteEventDispatch>, signal: AbortSignal): Promise<void> {
    for await (const dispatch of source) {
      if (signal.aborted) return;
      if ("request" in dispatch) this.#start(dispatch); else this.broadcast(dispatch.event, dispatch.args);
    }
    if (!signal.aborted) throw new Error("typert gateway: forwarded Remote event source ended unexpectedly");
  }

  #start(source: Extract<RemoteEventDispatch, { request: object }>): void {
    const { signal: requestSignal, ...projectedRequest } = source.request as Record<string, unknown> & { signal?: unknown };
    if (!source.event || !jsonSafe(projectedRequest)) { source.reject(new TypeError("Remote Event request is not lossless JSON data")); return; }
    const agentId = agentIdentity(source.context.subject);
    if (agentId === undefined) { source.resolve({ kind: "next" }); return; }
    const pending: Pending = { id: randomUUID(), source, clients: new Set(), cleanup: [], settled: false };
    this.#pending.set(pending.id, pending);
    if (requestSignal instanceof AbortSignal) {
      const cancel = () => this.#reject(pending, requestSignal.reason ?? new Error("Remote Event request cancelled"));
      requestSignal.addEventListener("abort", cancel, { once: true }); pending.cleanup.push(() => requestSignal.removeEventListener("abort", cancel));
    }
    if (typeof source.context.value.effect === "function") {
      try {
        const dispose = source.context.value.effect(() => () => this.#reject(pending, new Error("Remote Event Context released")), `Remote Event ${source.event}`);
        if (typeof dispose === "function") pending.cleanup.push(() => { void dispose(); });
      } catch { this.#settle(pending, { kind: "next" }); return; }
    }
    for (const client of this.#clients.values()) this.#deliver(pending, client, agentId);
  }

  #deliver(pending: Pending, client: Client, forcedAgentId?: string): void {
    const agentId = forcedAgentId ?? agentIdentity(pending.source.context.subject); if (agentId === undefined) return;
    pending.clients.add(client.id);
    const { signal: _signal, ...request } = pending.source.request as Record<string, unknown> & { signal?: unknown };
    client.queue.push({ type: "waterfall", event: pending.source.event, eventId: pending.id, agentId, request });
  }

  #settle(pending: Pending, outcome: { kind: "next" } | { kind: "result"; value?: unknown }): void {
    if (pending.settled) return; pending.settled = true; this.#pending.delete(pending.id); for (const cleanup of pending.cleanup.splice(0)) cleanup(); pending.source.resolve(outcome);
    for (const clientId of pending.clients) this.#clients.get(clientId)?.queue.push({ type: "cancel", eventId: pending.id });
  }
  #reject(pending: Pending, reason: unknown): void {
    if (pending.settled) return; pending.settled = true; this.#pending.delete(pending.id); for (const cleanup of pending.cleanup.splice(0)) cleanup(); pending.source.reject(reason);
    for (const clientId of pending.clients) this.#clients.get(clientId)?.queue.push({ type: "cancel", eventId: pending.id });
  }
  #close(reason: unknown): void {
    for (const pending of [...this.#pending.values()]) this.#reject(pending, reason);
    for (const client of this.#clients.values()) client.queue.close();
  }
}

class EventQueue {
  readonly #values: unknown[] = []; #wake: (() => void) | undefined; #closed = false;
  constructor(readonly signal: AbortSignal) { signal.addEventListener("abort", () => this.close(), { once: true }); }
  push(value: unknown): void { if (this.#closed) return; this.#values.push(value); const wake = this.#wake; this.#wake = undefined; wake?.(); }
  close(): void { if (this.#closed) return; this.#closed = true; const wake = this.#wake; this.#wake = undefined; wake?.(); }
  async *iterate(): AsyncGenerator<unknown> { while (!this.#closed && !this.signal.aborted) { if (this.#values.length > 0) { yield this.#values.shift(); continue; } await new Promise<void>((resolve) => { this.#wake = resolve; }); } }
}

function remoteArgs(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
  const args = (payload as { args?: unknown }).args; return args !== null && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
}
function failure(code: string, message: string) { return { ok: false as const, error: { code, message, details: {} } }; }
function jsonSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => jsonSafe(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.entries(value).every(([, entry]) => jsonSafe(entry, seen));
  seen.delete(value); return valid;
}
function agentIdentity(subject: unknown): string | undefined {
  if (typeof subject === "string" && subject.length > 0) return subject;
  if (subject === null || typeof subject !== "object") return undefined;
  for (const key of ["agentId", "sessionId", "id"] as const) { const value = Reflect.get(subject, key); if (typeof value === "string" && value.length > 0) return value; }
  return undefined;
}
