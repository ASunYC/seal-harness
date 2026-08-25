import { DuplicateServiceProviderError, MissingServiceError } from "./errors.js";
import type { ServiceToken } from "./token.js";

interface ServiceEntry<T> {
  readonly ownerId: string;
  readonly value: T;
}

export class ServiceRegistry {
  readonly #services = new Map<symbol, ServiceEntry<unknown>>();

  has<T>(token: ServiceToken<T>): boolean {
    return this.#services.has(token.id);
  }

  get<T>(token: ServiceToken<T>, consumerId?: string): T {
    const entry = this.#services.get(token.id);
    if (entry === undefined) {
      throw new MissingServiceError(token, consumerId);
    }
    return entry.value as T;
  }

  provide<T>(ownerId: string, token: ServiceToken<T>, value: T): () => void {
    const existing = this.#services.get(token.id);
    if (existing !== undefined) {
      throw new DuplicateServiceProviderError(token, existing.ownerId, ownerId);
    }

    const entry: ServiceEntry<T> = { ownerId, value };
    this.#services.set(token.id, entry as ServiceEntry<unknown>);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#services.get(token.id) === entry) {
        this.#services.delete(token.id);
      }
    };
  }

  ownerOf(token: ServiceToken<unknown>): string | undefined {
    return this.#services.get(token.id)?.ownerId;
  }
}
