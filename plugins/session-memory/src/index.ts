import {
  SessionAlreadyExistsError,
  assertSessionSurfaceAppend,
  materializeForkEvents,
  SessionConflictError,
  SessionNotFoundError,
  sessionStoreToken,
  type AppendSessionRequest,
  type CreateSessionRequest,
  type ForkSessionRequest,
  type SealHarnessEvents,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type StoredSessionEvent,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface MemorySessionConfig {
  readonly now?: () => Date;
}

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<SessionId, SessionSnapshot>();

  constructor(readonly now: () => Date = () => new Date(), readonly notify: SessionNotifier = async () => {}) {}

  async create(request: CreateSessionRequest): Promise<SessionSnapshot> {
    if (this.#sessions.has(request.id)) throw new SessionAlreadyExistsError(request.id);
    const created: StoredSessionEvent = {
      sequence: 1,
      timestamp: this.now().toISOString(),
      event: {
        type: "session.created",
        payload: {
          cwd: request.cwd,
          ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
        },
      },
    };
    const base: SessionSnapshot = { id: request.id, version: 1, events: [created] };
    assertSessionSurfaceAppend(base, request.initialEvents ?? []);
    const initial = (request.initialEvents ?? []).map((event, index): StoredSessionEvent => ({ sequence: index + 2, timestamp: this.now().toISOString(), event }));
    const snapshot: SessionSnapshot = {
      id: request.id,
      version: 1 + initial.length,
      events: [created, ...initial],
    };
    this.#sessions.set(request.id, clone(snapshot));
    await announce(this.notify, request.id, snapshot.events);
    return clone(snapshot);
  }

  async read(id: SessionId): Promise<SessionSnapshot | undefined> {
    return this.readExisting(id);
  }

  async delete(id: SessionId): Promise<boolean> { return this.#sessions.delete(id); }

  private async readExisting(id: SessionId): Promise<SessionSnapshot | undefined> {
    const snapshot = this.#sessions.get(id);
    return snapshot === undefined ? undefined : clone(snapshot);
  }

  async append(request: AppendSessionRequest): Promise<SessionSnapshot> {
    const current = this.#sessions.get(request.id);
    if (current === undefined) throw new SessionNotFoundError(request.id);
    if (request.expectedVersion !== current.version) {
      throw new SessionConflictError(request.id, request.expectedVersion, current.version);
    }
    if (request.events.length === 0) return clone(current);
    assertSessionSurfaceAppend(current, request.events);

    const appended = request.events.map((event, index): StoredSessionEvent => ({
      sequence: current.version + index + 1,
      timestamp: this.now().toISOString(),
      event,
    }));
    const next: SessionSnapshot = {
      id: current.id,
      version: current.version + appended.length,
      events: [...current.events, ...appended],
    };
    this.#sessions.set(request.id, clone(next));
    await announce(this.notify, request.id, appended);
    return clone(next);
  }

  async fork(request: ForkSessionRequest): Promise<SessionSnapshot> {
    if (this.#sessions.has(request.targetId)) {
      throw new SessionAlreadyExistsError(request.targetId);
    }
    const source = this.#sessions.get(request.sourceId);
    if (source === undefined) throw new SessionNotFoundError(request.sourceId);
    const events = materializeForkEvents(source, request.throughVersion, request.metadata);
    const stored = events.map((event, index): StoredSessionEvent => ({
      sequence: index + 1,
      timestamp: this.now().toISOString(),
      event,
    }));
    const target: SessionSnapshot = {
      id: request.targetId,
      version: stored.length,
      events: stored,
    };
    this.#sessions.set(request.targetId, clone(target));
    await announce(this.notify, request.targetId, stored);
    return clone(target);
  }

  async list(): Promise<readonly SessionSnapshot[]> {
    return [...this.#sessions.values()].map(clone);
  }
}

export const memorySessionPlugin = definePlugin<MemorySessionConfig, SealHarnessEvents>({
  name: "session-memory",
  provides: [sessionStoreToken],
  setup(context, config) {
    context.provide(sessionStoreToken, new MemorySessionStore(config.now, (sessionId, events) => context.emit("session.appended", { sessionId, events })));
  },
});

function clone<T>(value: T): T {
  return structuredClone(value);
}

type SessionNotifier = (sessionId: SessionId, events: readonly StoredSessionEvent[]) => Promise<void>;
async function announce(notify: SessionNotifier, sessionId: SessionId, events: readonly StoredSessionEvent[]): Promise<void> { try { await notify(sessionId, events); } catch { /* persistence remains authoritative when an observer fails */ } }
