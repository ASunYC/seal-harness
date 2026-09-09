import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SessionAlreadyExistsError,
  assertSessionSurfaceAppend,
  materializeForkEvents,
  SessionConflictError,
  SessionNotFoundError,
  sessionId,
  sessionStoreToken,
  type AppendSessionRequest,
  type CreateSessionRequest,
  type ForkSessionRequest,
  type SealHarnessEvents,
  type SessionEvent,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type StoredSessionEvent,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface SqliteSessionConfig {
  readonly path: string;
  readonly now?: () => Date;
}

interface SessionRow {
  readonly id: string;
  readonly version: number;
  readonly cwd: string;
  readonly metadata_json: string | null;
}

interface EventRow {
  readonly sequence: number;
  readonly timestamp: string;
  readonly event_json: string;
}

export class SqliteSessionStore implements SessionStore {
  readonly database: DatabaseSync;

  constructor(
    path: string,
    readonly now: () => Date = () => new Date(),
    readonly notify: SessionNotifier = async () => {},
  ) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.database = new DatabaseSync(path);
    const version = this.database.prepare("PRAGMA user_version").get() as unknown as {
      user_version: number;
    };
    if (version.user_version !== 0 && version.user_version !== 1) {
      this.database.close();
      throw new Error(`Unsupported SQLite session format: ${version.user_version}`);
    }
    this.database.exec("PRAGMA foreign_keys = ON");
    if (path !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        metadata_json TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_events (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (session_id, sequence)
      ) STRICT;
    `);
    if (version.user_version === 0) this.database.exec("PRAGMA user_version = 1");
  }

  close(): void { this.database.close(); }

  async create(request: CreateSessionRequest): Promise<SessionSnapshot> {
    const event: SessionEvent = {
      type: "session.created",
      payload: {
        cwd: request.cwd,
        ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
      },
    };
    const initialEvents = request.initialEvents ?? [];
    assertSessionSurfaceAppend({ id: request.id, version: 1, events: [{ sequence: 1, timestamp: new Date(0).toISOString(), event }] }, initialEvents);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        "INSERT INTO sessions (id, version, cwd, metadata_json) VALUES (?, ?, ?, ?)",
      ).run(
        request.id,
        1 + initialEvents.length,
        request.cwd,
        request.metadata === undefined ? null : JSON.stringify(request.metadata),
      );
      this.#insertEvent(request.id, 1, event);
      for (const [index, initial] of initialEvents.entries()) this.#insertEvent(request.id, index + 2, initial);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error).includes("UNIQUE constraint failed")) {
        throw new SessionAlreadyExistsError(request.id);
      }
      throw error;
    }
    const created = await this.read(request.id);
    if (created === undefined) throw new Error(`Failed to read created session: ${request.id}`);
    await announce(this.notify, request.id, created.events);
    return created;
  }

  async read(id: SessionId): Promise<SessionSnapshot | undefined> {
    const row = this.database.prepare(
      "SELECT id, version, cwd, metadata_json FROM sessions WHERE id = ?",
    ).get(id) as unknown as SessionRow | undefined;
    if (row === undefined) return undefined;
    const events = this.database.prepare(
      "SELECT sequence, timestamp, event_json FROM session_events WHERE session_id = ? ORDER BY sequence",
    ).all(id) as unknown as EventRow[];
    if (events.length !== row.version) {
      throw new Error(`SQLite session ${id} version/event count mismatch`);
    }
    return {
      id: sessionId(row.id),
      version: row.version,
      events: events.map((event) => ({
        sequence: event.sequence,
        timestamp: event.timestamp,
        event: JSON.parse(event.event_json) as SessionEvent,
      })),
    };
  }

  async append(request: AppendSessionRequest): Promise<SessionSnapshot> {
    const before = await this.read(request.id);
    if (before === undefined) throw new SessionNotFoundError(request.id);
    if (before.version !== request.expectedVersion) throw new SessionConflictError(request.id, request.expectedVersion, before.version);
    assertSessionSurfaceAppend(before, request.events);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT version FROM sessions WHERE id = ?").get(
        request.id,
      ) as unknown as { version: number } | undefined;
      if (row === undefined) throw new SessionNotFoundError(request.id);
      if (row.version !== request.expectedVersion) {
        throw new SessionConflictError(request.id, request.expectedVersion, row.version);
      }
      for (const [index, event] of request.events.entries()) {
        this.#insertEvent(request.id, row.version + index + 1, event);
      }
      if (request.events.length > 0) {
        this.database.prepare("UPDATE sessions SET version = ? WHERE id = ?").run(
          row.version + request.events.length,
          request.id,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    const updated = await this.read(request.id);
    if (updated === undefined) throw new SessionNotFoundError(request.id);
    if (request.events.length > 0) await announce(this.notify, request.id, updated.events.slice(-request.events.length));
    return updated;
  }

  async fork(request: ForkSessionRequest): Promise<SessionSnapshot> {
    const source = await this.read(request.sourceId);
    if (source === undefined) throw new SessionNotFoundError(request.sourceId);
    const events = materializeForkEvents(source, request.throughVersion, request.metadata);
    const created = events[0];
    if (created?.type !== "session.created") throw new Error(`Source session has no creation event: ${request.sourceId}`);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        "INSERT INTO sessions (id, version, cwd, metadata_json) VALUES (?, ?, ?, ?)",
      ).run(
        request.targetId,
        events.length,
        created.payload.cwd,
        created.payload.metadata === undefined
          ? null
          : JSON.stringify(created.payload.metadata),
      );
      for (const [index, event] of events.entries()) {
        this.#insertEvent(request.targetId, index + 1, event);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error).includes("UNIQUE constraint failed")) {
        throw new SessionAlreadyExistsError(request.targetId);
      }
      throw error;
    }
    const target = await this.read(request.targetId);
    if (target === undefined) throw new Error(`Failed to read forked session: ${request.targetId}`);
    await announce(this.notify, request.targetId, target.events);
    return target;
  }

  async list(): Promise<readonly SessionSnapshot[]> {
    return this.listExisting();
  }

  async delete(id: SessionId): Promise<boolean> {
    return Number(this.database.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes) > 0;
  }

  private async listExisting(): Promise<readonly SessionSnapshot[]> {
    const rows = this.database.prepare("SELECT id FROM sessions ORDER BY rowid").all() as unknown as Array<{ id: string }>;
    const sessions: SessionSnapshot[] = [];
    for (const row of rows) {
      const value = await this.read(sessionId(row.id));
      if (value !== undefined) sessions.push(value);
    }
    return sessions;
  }

  #insertEvent(id: SessionId, sequence: number, event: SessionEvent): void {
    this.database.prepare(
      "INSERT INTO session_events (session_id, sequence, timestamp, event_json) VALUES (?, ?, ?, ?)",
    ).run(id, sequence, this.now().toISOString(), JSON.stringify(event));
  }
}

export const sqliteSessionPlugin = definePlugin<SqliteSessionConfig, SealHarnessEvents>({
  name: "session-sqlite",
  provides: [sessionStoreToken],
  setup(context, config) {
    const store = new SqliteSessionStore(config.path, config.now, (sessionId, events) => context.emit("session.appended", { sessionId, events }));
    context.provide(sessionStoreToken, store);
    context.effect(() => store.close());
  },
});

type SessionNotifier = (sessionId: SessionId, events: readonly StoredSessionEvent[]) => Promise<void>;
async function announce(notify: SessionNotifier, sessionId: SessionId, events: readonly StoredSessionEvent[]): Promise<void> { try { await notify(sessionId, events); } catch { /* persistence remains authoritative when an observer fails */ } }
