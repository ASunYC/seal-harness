import { open, mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SessionAlreadyExistsError,
  SessionConflictError,
  SessionNotFoundError,
  sessionId,
  sessionStoreToken,
  type AppendSessionRequest,
  type CreateSessionRequest,
  type PiHarnessEvents,
  type SessionEvent,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type StoredSessionEvent,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

interface JsonlRecord extends StoredSessionEvent {
  readonly sessionId: SessionId;
}

export interface JsonlSessionConfig {
  readonly root: string;
  readonly now?: () => Date;
}

export class JsonlSessionStore implements SessionStore {
  readonly root: string;
  readonly #queues = new Map<SessionId, Promise<unknown>>();

  constructor(
    root: string,
    readonly now: () => Date = () => new Date(),
  ) {
    this.root = resolve(root);
  }

  async create(request: CreateSessionRequest): Promise<SessionSnapshot> {
    return this.#serialized(request.id, async () => {
      await mkdir(this.root, { recursive: true });
      const path = this.#path(request.id);
      const record: JsonlRecord = {
        sessionId: request.id,
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
      let handle;
      try {
        handle = await open(path, "wx");
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new SessionAlreadyExistsError(request.id);
        }
        throw error;
      } finally {
        await handle?.close();
      }
      return snapshot(request.id, [record]);
    });
  }

  async read(id: SessionId): Promise<SessionSnapshot | undefined> {
    try {
      return snapshot(id, await this.#readRecords(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async append(request: AppendSessionRequest): Promise<SessionSnapshot> {
    return this.#serialized(request.id, async () => {
      const current = await this.read(request.id);
      if (current === undefined) throw new SessionNotFoundError(request.id);
      if (current.version !== request.expectedVersion) {
        throw new SessionConflictError(request.id, request.expectedVersion, current.version);
      }
      if (request.events.length === 0) return current;

      const records = request.events.map((event, index): JsonlRecord => ({
        sessionId: request.id,
        sequence: current.version + index + 1,
        timestamp: this.now().toISOString(),
        event,
      }));
      const handle = await open(this.#path(request.id), "a");
      try {
        await handle.writeFile(records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return snapshot(request.id, [
        ...current.events.map((entry): JsonlRecord => ({ sessionId: request.id, ...entry })),
        ...records,
      ]);
    });
  }

  async list(): Promise<readonly SessionSnapshot[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      const sessions: SessionSnapshot[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const encoded = entry.name.slice(0, -".jsonl".length);
        const id = sessionId(Buffer.from(encoded, "base64url").toString("utf8"));
        const value = await this.read(id);
        if (value !== undefined) sessions.push(value);
      }
      return sessions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #readRecords(id: SessionId): Promise<JsonlRecord[]> {
    const content = await readFile(this.#path(id), "utf8");
    const lines = content.split("\n");
    const records: JsonlRecord[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) continue;
      try {
        const record = JSON.parse(line) as JsonlRecord;
        validateRecord(record, id, records.length + 1);
        records.push(record);
      } catch (error) {
        const isLastContentLine = lines.slice(index + 1).every((candidate) => candidate.length === 0);
        if (isLastContentLine) break;
        throw error;
      }
    }
    return records;
  }

  #path(id: SessionId): string {
    return join(this.root, `${Buffer.from(id).toString("base64url")}.jsonl`);
  }

  async #serialized<T>(id: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.#queues.set(id, current);
    try {
      return await current;
    } finally {
      if (this.#queues.get(id) === current) this.#queues.delete(id);
    }
  }
}

export const jsonlSessionPlugin = definePlugin<JsonlSessionConfig, PiHarnessEvents>({
  name: "session-jsonl",
  provides: [sessionStoreToken],
  setup(context, config) {
    context.provide(sessionStoreToken, new JsonlSessionStore(config.root, config.now));
  },
});

function validateRecord(record: JsonlRecord, id: SessionId, sequence: number): void {
  if (record.sessionId !== id) throw new Error(`Session id mismatch at sequence ${sequence}`);
  if (record.sequence !== sequence) throw new Error(`Session sequence mismatch: expected ${sequence}`);
  if (typeof record.timestamp !== "string" || typeof record.event !== "object") {
    throw new Error(`Invalid session record at sequence ${sequence}`);
  }
}

function snapshot(id: SessionId, records: readonly JsonlRecord[]): SessionSnapshot {
  return {
    id,
    version: records.length,
    events: records.map(({ sequence, timestamp, event }) => ({ sequence, timestamp, event })),
  };
}
