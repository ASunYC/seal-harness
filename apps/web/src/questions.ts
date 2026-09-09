import { randomUUID } from "node:crypto";
import type { AskUserQuestionAnswer, AskUserQuestionRequest, UserQuestionAnswerer } from "@seal-harness/core";

export interface PendingWebQuestion {
  readonly id: string;
  readonly sessionId: string;
  readonly questions: AskUserQuestionRequest["questions"];
  readonly createdAt: string;
}
interface PendingEntry { readonly value: PendingWebQuestion; readonly resolve: (answer: AskUserQuestionAnswer | undefined) => void; readonly reject: (error: unknown) => void; readonly signal?: AbortSignal; readonly onAbort?: () => void }

export class WebQuestionAnswerer {
  readonly #pending = new Map<string, PendingEntry>();
  readonly answer: UserQuestionAnswerer = async (request) => {
    request.signal?.throwIfAborted(); const id = randomUUID();
    return new Promise<AskUserQuestionAnswer | undefined>((resolve, reject) => {
      const onAbort = () => { this.#pending.delete(id); reject(request.signal?.reason ?? new Error("Question request aborted")); };
      const value: PendingWebQuestion = { id, sessionId: request.sessionId, questions: request.questions, createdAt: new Date().toISOString() };
      this.#pending.set(id, { value, resolve, reject, ...(request.signal === undefined ? {} : { signal: request.signal, onAbort }) });
      request.signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  list(): readonly PendingWebQuestion[] { return [...this.#pending.values()].map((x) => x.value); }
  decide(id: string, answer: AskUserQuestionAnswer): boolean { const entry = this.#pending.get(id); if (entry === undefined) return false; this.#pending.delete(id); if (entry.signal !== undefined && entry.onAbort !== undefined) entry.signal.removeEventListener("abort", entry.onAbort); entry.resolve(answer); return true; }
  close(reason: unknown = new Error("Web question answerer stopped")): void { for (const [id, entry] of this.#pending) { this.#pending.delete(id); if (entry.signal !== undefined && entry.onAbort !== undefined) entry.signal.removeEventListener("abort", entry.onAbort); entry.reject(reason); } }
}
