import {
  SessionAlreadyExistsError,
  SessionConflictError,
  SessionNotFoundError,
  sessionStoreToken,
  type AppendSessionRequest,
  type CreateSessionRequest,
  type PiHarnessEvents,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type StoredSessionEvent,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

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

  async list(): Promise<readonly SessionSnapshot[]> {
    return [...this.#sessions.values()].map(clone);
  }
}

export const memorySessionPlugin = definePlugin<MemorySessionConfig, PiHarnessEvents>({
  name: "session-memory",
  provides: [sessionStoreToken],
  setup(context, config) {
    context.provide(sessionStoreToken, new MemorySessionStore(config.now));
  },
});

function clone<T>(value: T): T {
  return structuredClone(value);
}
