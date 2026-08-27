import {
  SessionAlreadyExistsError,
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

  constructor(readonly now: () => Date = () => new Date()) {}

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
    const snapshot: SessionSnapshot = {
      id: request.id,
      version: 1,
      events: [created],
    };
    this.#sessions.set(request.id, clone(snapshot));
    return clone(snapshot);
  }

  async read(id: SessionId): Promise<SessionSnapshot | undefined> {
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
    return clone(next);
  }

  async fork(request: ForkSessionRequest): Promise<SessionSnapshot> {
    if (this.#sessions.has(request.targetId)) {
      throw new SessionAlreadyExistsError(request.targetId);
    }
    const source = this.#sessions.get(request.sourceId);
    if (source === undefined) throw new SessionNotFoundError(request.sourceId);
    const throughVersion = request.throughVersion ?? source.version;
    if (throughVersion < 1 || throughVersion > source.version) {
      throw new RangeError(`Invalid fork version ${throughVersion} for session ${request.sourceId}`);
    }
    const selected = source.events.slice(0, throughVersion);
    const created = selected.find((entry) => entry.event.type === "session.created");
    if (created?.event.type !== "session.created") {
      throw new Error(`Source session has no creation event: ${request.sourceId}`);
    }
    const events = [
      {
        type: "session.created" as const,
        payload: created.event.payload,
      },
      {
        type: "session.forked" as const,
        payload: { sourceSessionId: request.sourceId, sourceVersion: throughVersion },
      },
      ...selected.flatMap((entry) =>
        entry.event.type === "message.appended" || entry.event.type === "context.compacted"
          ? [entry.event]
          : [],
      ),
    ];
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
    context.provide(sessionStoreToken, new MemorySessionStore(config.now));
  },
});

function clone<T>(value: T): T {
  return structuredClone(value);
}
