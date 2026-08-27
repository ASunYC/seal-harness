import type { IncomingMessage, ServerResponse } from "node:http";

export interface DshWebRoute {
  readonly kind: "exact";
  readonly path: string;
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

export class WebRouteRegistry {
  readonly #routes = new Map<string, DshWebRoute>();

  register(route: DshWebRoute): () => void {
    if (route.kind !== "exact" || !route.path.startsWith("/api/")) {
      throw new Error(`Unsupported DSH Web route: ${route.path}`);
    }
    if (/^\/api\/(?:health|models|sessions|approvals|credentials|runs|plugins)(?:\/|$)/.test(route.path)) {
      throw new Error(`DSH Web route conflicts with a Seal Harness API: ${route.path}`);
    }
    if (this.#routes.has(route.path)) throw new Error(`DSH Web route already registered: ${route.path}`);
    this.#routes.set(route.path, route);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#routes.get(route.path) === route) this.#routes.delete(route.path);
    };
  }

  get(path: string): DshWebRoute | undefined {
    return this.#routes.get(path);
  }
}
