import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { commandServiceToken, MessageFeedbackError, messageFeedbackServiceToken, SessionConflictError, sessionStoreToken, type CommandService, type MessageFeedbackItem, type MessageFeedbackService, type SealHarnessEvents, type SessionEvent, type SessionId, type SessionSnapshot, type SessionStore } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface FeedbackConfig { readonly root: string; readonly maxNoteBytes?: number }
interface FeedbackDocument { readonly formatVersion: 1; readonly session: { readonly createdAt: string; readonly cwd: string }; readonly items: readonly MessageFeedbackItem[] }
export const DEFAULT_FEEDBACK_NOTE_BYTES = 8_192;

export class DurableMessageFeedbackService implements MessageFeedbackService {
  readonly root: string; readonly maxNoteBytes: number; readonly #tails = new Map<SessionId, Promise<void>>();
  constructor(readonly sessions: SessionStore, config: FeedbackConfig, readonly idFactory: () => string = randomUUID, readonly now: () => Date = () => new Date()) {
    this.root = resolve(config.root); this.maxNoteBytes = config.maxNoteBytes ?? DEFAULT_FEEDBACK_NOTE_BYTES;
    if (!Number.isSafeInteger(this.maxNoteBytes) || this.maxNoteBytes < 1) throw new TypeError("maxNoteBytes must be a positive safe integer");
  }
  async list(sessionId: SessionId): Promise<readonly MessageFeedbackItem[]> { return (await this.#read(await requireSession(this.sessions, sessionId))).items; }
  put(request: { sessionId: SessionId; messageId: string; rating: "up" | "down"; note?: string; ifVersion: string | null }): Promise<MessageFeedbackItem> {
    return this.#enqueue(request.sessionId, async () => {
      const session = await requireSession(this.sessions, request.sessionId); assertTarget(session, request.messageId);
      const document = await this.#read(session); const existing = document.items.find((item) => item.messageId === request.messageId);
      if ((existing?.version ?? null) !== request.ifVersion) throw new MessageFeedbackError("message feedback version conflict", "VERSION_CONFLICT", existing ?? null);
      const note = normalizeNote(request.note, this.maxNoteBytes); if (existing?.rating === request.rating && existing.note === note) return existing;
      const timestamp = this.now().toISOString();
      const item = Object.freeze<MessageFeedbackItem>({ messageId: request.messageId, rating: request.rating, ...(note === undefined ? {} : { note }), version: this.idFactory(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
      await this.#write(request.sessionId, { ...document, items: [...document.items.filter((candidate) => candidate.messageId !== request.messageId), item] }); return item;
    });
  }
  delete(request: { sessionId: SessionId; messageId: string; ifVersion: string | null }): Promise<boolean> {
    return this.#enqueue(request.sessionId, async () => {
      const session = await requireSession(this.sessions, request.sessionId); const document = await this.#read(session); const existing = document.items.find((item) => item.messageId === request.messageId);
      if (existing === undefined) return true;
      if (existing.version !== request.ifVersion) throw new MessageFeedbackError("message feedback version conflict", "VERSION_CONFLICT", existing);
      await this.#write(request.sessionId, { ...document, items: document.items.filter((item) => item.messageId !== request.messageId) }); return true;
    });
  }
  async #read(session: SessionSnapshot): Promise<FeedbackDocument> {
    const identity = sessionIdentity(session);
    try { const parsed = JSON.parse(await readFile(this.#path(session.id), "utf8")) as FeedbackDocument; return parsed.formatVersion === 1 && parsed.session.createdAt === identity.createdAt && parsed.session.cwd === identity.cwd && Array.isArray(parsed.items) ? parsed : { formatVersion: 1, session: identity, items: [] }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { formatVersion: 1, session: identity, items: [] }; throw error; }
  }
  async #write(sessionId: SessionId, document: FeedbackDocument): Promise<void> {
    await mkdir(this.root, { recursive: true }); const path = this.#path(sessionId); const temporary = `${path}.tmp-${randomUUID()}`;
    try { await writeFile(temporary, JSON.stringify(document), { encoding: "utf8", flag: "wx" }); await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
  }
  #path(sessionId: SessionId): string { return join(this.root, `${createHash("sha256").update(sessionId).digest("hex")}.json`); }
  #enqueue<T>(id: SessionId, operation: () => Promise<T>): Promise<T> { const previous = this.#tails.get(id) ?? Promise.resolve(); const result = previous.then(operation); const tail = result.then(() => undefined, () => undefined); this.#tails.set(id, tail); return result.finally(() => { if (this.#tails.get(id) === tail) this.#tails.delete(id); }); }
}

function sessionIdentity(session: SessionSnapshot): FeedbackDocument["session"] { const created = session.events.find((entry) => entry.event.type === "session.created"); if (created?.event.type !== "session.created") throw new MessageFeedbackError("session has no creation event", "SESSION_INVALID"); return { createdAt: created.timestamp, cwd: created.event.payload.cwd }; }
function assertTarget(session: SessionSnapshot, id: string): void { if (!session.events.some((entry) => entry.event.type === "message.appended" && entry.event.payload.messageId === id && entry.event.payload.message.role === "assistant")) throw new MessageFeedbackError("assistant message target not found", "TARGET_NOT_FOUND"); }
function normalizeNote(note: string | undefined, max: number): string | undefined { if (note === undefined) return undefined; if (note.trim() === "") throw new MessageFeedbackError("feedback note must not be blank", "NOTE_BLANK"); if (Buffer.byteLength(note) > max) throw new MessageFeedbackError("feedback note is too large", "NOTE_TOO_LARGE"); return note; }
async function requireSession(store: SessionStore, id: SessionId): Promise<SessionSnapshot> { const session = await store.read(id); if (session === undefined) throw new MessageFeedbackError("session not found", "SESSION_NOT_FOUND"); return session; }
async function append(store: SessionStore, session: SessionSnapshot, event: SessionEvent): Promise<void> { try { await store.append({ id: session.id, expectedVersion: session.version, events: [event] }); } catch (error) { if (!(error instanceof SessionConflictError)) throw error; const latest = await requireSession(store, session.id); await store.append({ id: latest.id, expectedVersion: latest.version, events: [event] }); } }
function registerFeedbackCommand(commands: CommandService, sessions: SessionStore): () => void { return commands.register({ name: "feedback", description: "record feedback about this session", input: { hint: "<text>" }, recordInput: false, async handler(invocation) { const value = invocation.rawInput.trim(); if (value === "") return { kind: "error", text: "Feedback text is required. Usage: /feedback <text>" }; const session = await requireSession(sessions, invocation.sessionId); await append(sessions, session, { type: "feedback.recorded", payload: { text: value } }); return { kind: "success", text: `Feedback recorded for session ${invocation.sessionId}. Session sharing is not configured.` }; } }); }
export const feedbackToolsPlugin = definePlugin<FeedbackConfig, SealHarnessEvents>({ name: "feedback-tools", provides: [messageFeedbackServiceToken], requires: [sessionStoreToken, commandServiceToken], setup(context, config) { const sessions = context.use(sessionStoreToken); context.provide(messageFeedbackServiceToken, new DurableMessageFeedbackService(sessions, config)); context.effect(registerFeedbackCommand(context.use(commandServiceToken), sessions)); } });
