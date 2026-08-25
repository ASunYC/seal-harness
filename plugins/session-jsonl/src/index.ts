import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SessionAlreadyExistsError,
  SessionConflictError,
  SessionNotFoundError,
  sessionId,
  sessionStoreToken,
  type AppendSessionRequest,
  type CreateSessionRequest,
  type ForkSessionRequest,
  type PiHarnessEvents,
  type SessionEvent,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type StoredSessionEvent,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

interface JsonlTransactionRecord {
  readonly timestamp: string;
  readonly event: SessionEvent;
}

interface JsonlTransaction {
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
  ) {
    this.root = resolve(root);
  }

  async create(request: CreateSessionRequest): Promise<SessionSnapshot> {
    return this.#serialized(request.id, async () => {
      const transaction = this.#transaction(request.id, 1, [{
        type: "session.created",
        payload: {
          cwd: request.cwd,
          ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
        },
      }]);
      await mkdir(this.root, { recursive: true });
      await this.#writeExclusive(this.#path(request.id), transaction, request.id);
      return snapshot(request.id, expandTransactions(request.id, [transaction]));
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
  }

  async fork(request: ForkSessionRequest): Promise<SessionSnapshot> {
    const source = await this.read(request.sourceId);
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
    const events: SessionEvent[] = [
      {
        type: "session.created",
        payload: created.event.payload,
      },
      {
        type: "session.forked",
        payload: { sourceSessionId: request.sourceId, sourceVersion: throughVersion },
      },
      ...selected.flatMap((entry) =>
        entry.event.type === "message.appended" || entry.event.type === "context.compacted"
          ? [entry.event]
          : [],
      ),
    ];

    return this.#serialized(request.targetId, async () => {
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

  async #readRecords(id: SessionId): Promise<StoredSessionEvent[]> {
    const content = await readFile(this.#path(id), "utf8");
    const lines = content.split("\n");
    const transactions: JsonlTransaction[] = [];
    let expectedSequence = 1;
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) continue;
      try {
        const transaction = JSON.parse(line) as JsonlTransaction;
        validateTransaction(transaction, id, expectedSequence);
        transactions.push(transaction);
        expectedSequence += transaction.records.length;
      } catch (error) {
        const isLastContentLine = lines.slice(index + 1).every((candidate) => candidate.length === 0);
        if (isLastContentLine) break;
        throw error;
      }
    }
    return expandTransactions(id, transactions);
  }

  #transaction(
    id: SessionId,
    startSequence: number,
    events: readonly SessionEvent[],
  ): JsonlTransaction {
    return {
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

export const jsonlSessionPlugin = definePlugin<JsonlSessionConfig, PiHarnessEvents>({
  name: "session-jsonl",
  provides: [sessionStoreToken],
  setup(context, config) {
    context.provide(sessionStoreToken, new JsonlSessionStore(config.root, config.now));
  },
});

function validateTransaction(
  transaction: JsonlTransaction,
  id: SessionId,
  expectedSequence: number,
): void {
  if (transaction.sessionId !== id) {
    throw new Error(`Session id mismatch at sequence ${expectedSequence}`);
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
