import { randomUUID } from "node:crypto";
import type { ApprovalRequest, ApprovalService, JsonObject } from "@seal-harness/core";

export interface PendingWebApproval {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly details?: JsonObject;
  readonly createdAt: string;
}

interface PendingEntry {
  readonly value: PendingWebApproval;
  readonly resolve: (approved: boolean) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export class WebApprovalService implements ApprovalService {
  readonly #pending = new Map<string, PendingEntry>();

  async request(request: ApprovalRequest): Promise<boolean> {
    request.signal.throwIfAborted();
    const id = randomUUID();
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = (): void => {
        this.#pending.delete(id);
        reject(request.signal.reason ?? new Error("Approval request aborted"));
      };
      const value: PendingWebApproval = {
        id,
        title: request.title,
        message: request.message,
        ...(request.details === undefined ? {} : { details: request.details }),
        createdAt: new Date().toISOString(),
      };
      this.#pending.set(id, { value, resolve, reject, signal: request.signal, onAbort });
      request.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  list(): readonly PendingWebApproval[] {
    return [...this.#pending.values()].map((entry) => entry.value);
  }

  decide(id: string, approved: boolean): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    this.#pending.delete(id);
    entry.signal.removeEventListener("abort", entry.onAbort);
    entry.resolve(approved);
    return true;
  }

  close(reason: unknown = new Error("Web approval service stopped")): void {
    for (const [id, entry] of this.#pending) {
      this.#pending.delete(id);
      entry.signal.removeEventListener("abort", entry.onAbort);
      entry.reject(reason);
    }
  }
}
