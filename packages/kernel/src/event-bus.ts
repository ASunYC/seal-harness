import type { EventHandler, EventMap } from "./types.js";

interface Listener<TPayload> {
  readonly ownerId: string;
  readonly handler: EventHandler<TPayload>;
}

export class EventBus<TEvents extends EventMap> {
  readonly #listeners = new Map<keyof TEvents & string, Listener<unknown>[]>();

  on<K extends keyof TEvents & string>(
    ownerId: string,
    event: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void {
    const listeners = this.#listeners.get(event) ?? [];
    const listener: Listener<TEvents[K]> = { ownerId, handler };
    listeners.push(listener as Listener<unknown>);
    this.#listeners.set(event, listeners);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.#listeners.get(event);
      if (current === undefined) return;
      const index = current.indexOf(listener as Listener<unknown>);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#listeners.delete(event);
    };
  }

  async emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void> {
    const snapshot = [...(this.#listeners.get(event) ?? [])] as Listener<TEvents[K]>[];
    for (const listener of snapshot) {
      await listener.handler(payload);
    }
  }

  removeOwner(ownerId: string): void {
    for (const [event, listeners] of this.#listeners) {
      const remaining = listeners.filter((listener) => listener.ownerId !== ownerId);
      if (remaining.length === 0) this.#listeners.delete(event);
      else this.#listeners.set(event, remaining);
    }
  }
}
