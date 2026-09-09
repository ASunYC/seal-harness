import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, unlink, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
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
  type SessionRawArtifact,
  type SessionStore,
  type StoredSessionEvent,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

interface JsonlTransactionRecord {
  readonly timestamp: string;
  readonly event: SessionEvent;
}

interface JsonlTransaction {
  readonly formatVersion: 1;
  readonly sessionId: SessionId;
  readonly startSequence: number;
  readonly records: readonly JsonlTransactionRecord[];
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
    readonly notify: SessionNotifier = async () => {},
  ) {
    this.root = resolve(root);
  }

  async create(request: CreateSessionRequest): Promise<SessionSnapshot> {
    const result = await this.#serialized(request.id, async () => {
      const created: SessionEvent = {
        type: "session.created",
        payload: {
          cwd: request.cwd,
          ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
        },
      };
      const base = snapshot(request.id, expandTransactions(request.id, [this.#transaction(request.id, 1, [created])]));
      assertSessionSurfaceAppend(base, request.initialEvents ?? []);
      const transaction = this.#transaction(request.id, 1, [created, ...(request.initialEvents ?? [])]);
      await mkdir(this.root, { recursive: true });
      await this.#writeExclusive(this.#path(request.id), transaction, request.id);
      return snapshot(request.id, expandTransactions(request.id, [transaction]));
    });
    await announce(this.notify, request.id, result.events);
    return result;
  }

  async read(id: SessionId): Promise<SessionSnapshot | undefined> {
    try {
      return snapshot(id, await this.#readRecords(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  locate(id: SessionId): { readonly kind: "jsonl"; readonly path: string } {
    return { kind: "jsonl", path: this.#path(id) };
  }

  async readRaw(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined> {
    signal?.throwIfAborted();
    try {
      const content = await readFile(this.#path(id), { encoding: "utf8", signal });
      signal?.throwIfAborted();
      return {
        filename: `${Buffer.from(id).toString("base64url")}.jsonl`,
        content,
        snapshot: snapshot(id, this.#parseRecords(id, content)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async append(request: AppendSessionRequest): Promise<SessionSnapshot> {
    const result = await this.#serialized(request.id, async () => {
      const current = await this.read(request.id);
      if (current === undefined) throw new SessionNotFoundError(request.id);
      if (current.version !== request.expectedVersion) {
        throw new SessionConflictError(request.id, request.expectedVersion, current.version);
      }
      if (request.events.length === 0) return current;
      assertSessionSurfaceAppend(current, request.events);

      const transaction = this.#transaction(
        request.id,
        current.version + 1,
        request.events,
      );
      const handle = await open(this.#path(request.id), "a");
      try {
        // One logical append is one physical JSONL line. A torn final write is
        // ignored as a whole transaction during recovery.
        await handle.writeFile(`${JSON.stringify(transaction)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return snapshot(request.id, [
        ...current.events,
        ...expandTransactions(request.id, [transaction], current.version + 1),
      ]);
    });
    if (request.events.length > 0) await announce(this.notify, request.id, result.events.slice(-request.events.length));
    return result;
  }

  async fork(request: ForkSessionRequest): Promise<SessionSnapshot> {
    const source = await this.read(request.sourceId);
    if (source === undefined) throw new SessionNotFoundError(request.sourceId);
    const events = materializeForkEvents(source, request.throughVersion, request.metadata);

    const result = await this.#serialized(request.targetId, async () => {
      await mkdir(this.root, { recursive: true });
      const transaction = this.#transaction(request.targetId, 1, events);
      const targetPath = this.#path(request.targetId);
      const temporaryPath = `${targetPath}.tmp-${randomUUID()}`;
      try {
        await this.#writeExclusive(temporaryPath, transaction, request.targetId);
        try {
          // Publishing a hard link is atomic and fails when the target exists.
          await link(temporaryPath, targetPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new SessionAlreadyExistsError(request.targetId);
          }
          throw error;
        }
      } finally {
        await unlink(temporaryPath).catch(() => {});
      }
      return snapshot(
        request.targetId,
        expandTransactions(request.targetId, [transaction]),
      );
    });
    await announce(this.notify, request.targetId, result.events);
    return result;
  }

  async list(): Promise<readonly SessionSnapshot[]> {
    return this.listExisting();
  }

  async delete(id: SessionId): Promise<boolean> {
    return this.#serialized(id, async () => {
      try {
        // Retain a recoverable artifact outside the active .jsonl catalog.
        await rename(this.#path(id), this.#path(id) + "." + randomUUID() + ".deleted");
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    });
  }

  private async listExisting(): Promise<readonly SessionSnapshot[]> {
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

  async #readRecords(id: SessionId): Promise<StoredSessionEvent[]> {
    const content = await readFile(this.#path(id), "utf8");
    return this.#parseRecords(id, content);
  }

  #parseRecords(id: SessionId, content: string): StoredSessionEvent[] {
    const lines = content.split("\n");
    const transactions: JsonlTransaction[] = [];
    let expectedSequence = 1;
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) continue;
      let transaction: JsonlTransaction;
      try {
        transaction = JSON.parse(line) as JsonlTransaction;
      } catch (error) {
        const isLastContentLine = lines.slice(index + 1).every((candidate) => candidate.length === 0);
        if (error instanceof SyntaxError && isLastContentLine) break;
        throw error;
      }
      validateTransaction(transaction, id, expectedSequence);
      transactions.push(transaction);
      expectedSequence += transaction.records.length;
    }
    return expandTransactions(id, transactions);
  }

  #transaction(
    id: SessionId,
    startSequence: number,
    events: readonly SessionEvent[],
  ): JsonlTransaction {
    return {
      formatVersion: 1,
      sessionId: id,
      startSequence,
      records: events.map((event) => ({
        timestamp: this.now().toISOString(),
        event,
      })),
    };
  }

  async #writeExclusive(
    path: string,
    transaction: JsonlTransaction,
    id: SessionId,
  ): Promise<void> {
    let handle;
    try {
      handle = await open(path, "wx");
      await handle.writeFile(`${JSON.stringify(transaction)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new SessionAlreadyExistsError(id);
      }
      throw error;
    } finally {
      await handle?.close();
    }
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

export const jsonlSessionPlugin = definePlugin<JsonlSessionConfig, SealHarnessEvents>({
  name: "session-jsonl",
  provides: [sessionStoreToken],
  setup(context, config) {
    context.provide(sessionStoreToken, new JsonlSessionStore(config.root, config.now, (sessionId, events) => context.emit("session.appended", { sessionId, events })));
  },
});

type SessionNotifier = (sessionId: SessionId, events: readonly StoredSessionEvent[]) => Promise<void>;
async function announce(notify: SessionNotifier, sessionId: SessionId, events: readonly StoredSessionEvent[]): Promise<void> { try { await notify(sessionId, events); } catch { /* persistence remains authoritative when an observer fails */ } }

function validateTransaction(
  transaction: JsonlTransaction,
  id: SessionId,
  expectedSequence: number,
): void {
  if (transaction.sessionId !== id) {
    throw new Error(`Session id mismatch at sequence ${expectedSequence}`);
  }
  if (transaction.formatVersion !== 1) {
    throw new Error(`Unsupported JSONL session format: ${String(transaction.formatVersion)}`);
  }
  if (transaction.startSequence !== expectedSequence) {
    throw new Error(`Session sequence mismatch: expected ${expectedSequence}`);
  }
  if (!Array.isArray(transaction.records) || transaction.records.length === 0) {
    throw new Error(`Empty session transaction at sequence ${expectedSequence}`);
  }
  for (const [index, record] of transaction.records.entries()) {
    if (typeof record?.timestamp !== "string" || typeof record.event !== "object") {
      throw new Error(`Invalid session record at sequence ${expectedSequence + index}`);
    }
  }
}

function expandTransactions(
  id: SessionId,
  transactions: readonly JsonlTransaction[],
  initialSequence = 1,
): StoredSessionEvent[] {
  const events: StoredSessionEvent[] = [];
  let sequence = initialSequence;
  for (const transaction of transactions) {
    validateTransaction(transaction, id, sequence);
    for (const record of transaction.records) {
      events.push({ sequence, timestamp: record.timestamp, event: record.event });
      sequence += 1;
    }
  }
  return events;
}

function snapshot(id: SessionId, records: readonly StoredSessionEvent[]): SessionSnapshot {
  return { id, version: records.length, events: records };
}
