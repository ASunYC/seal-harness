import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { WebRouteService } from "@seal-harness/core";

export interface DshWebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

export interface DshWebUpgradeRoute {
  readonly path: string;
  handler(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export class WebRouteRegistry implements WebRouteService {
  readonly #routes = new Map<string, DshWebRoute>();
  readonly #upgrades = new Map<string, DshWebUpgradeRoute>();

  constructor(readonly host: "127.0.0.1" | "0.0.0.0" = "127.0.0.1") {}

  register(route: DshWebRoute): () => void {
    if ((route.kind !== "exact" && route.kind !== "prefix") || !route.path.startsWith("/") || route.path === "/"
      || route.path.endsWith("/") || route.path.includes("?") || route.path.includes("#")) {
      throw new Error(`Unsupported DSH Web route: ${route.path}`);
    }
    if (route.path === "/api" || /^\/api\/(?:health|models|events|commands|agent-presets|settings|providers|workspaces|attachments|sessions|archived-sessions|approvals|questions|credentials|runs|plugins|dsh)(?:\/|$)/.test(route.path)) {
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
    const exact = this.#routes.get(path); if (exact?.kind === "exact") return exact;
    return [...this.#routes.values()].filter((route) => route.kind === "prefix" && path.startsWith(`${route.path}/`)).sort((left, right) => right.path.length - left.path.length)[0];
  }

  registerUpgrade(route: DshWebUpgradeRoute): () => void {
    if (!validRoutePath(route.path)) throw new Error(`Unsupported DSH Web upgrade route: ${route.path}`);
    if (this.#upgrades.has(route.path)) throw new Error(`DSH Web upgrade route already registered: ${route.path}`);
    this.#upgrades.set(route.path, route);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#upgrades.get(route.path) === route) this.#upgrades.delete(route.path);
    };
  }

  getUpgrade(path: string): DshWebUpgradeRoute | undefined { return this.#upgrades.get(path); }
}

type ConnectionResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } };
type ConnectionHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionResult>;

/** Cordis-compatible Host Connection surface for third-party DSH plugins. */
export class DshConnectionBridge {
  readonly #interceptors: Array<{ readonly matches: (endpoint: string) => boolean; readonly handler: ConnectionHandler }> = [];
  constructor(readonly routes: WebRouteRegistry, readonly rejectRequest: (request: IncomingMessage) => 401 | 403 | undefined = () => undefined) {}

  requestRejection(request: IncomingMessage): 401 | 403 | undefined { return this.rejectRequest(request); }

  readonly rpc = {
    handle: (channel: string, handler: ConnectionHandler): (() => Promise<void>) => {
      assertConnectionChannel(channel);
      const dispose = this.routes.register({ kind: "prefix", path: channel, handler: (request, response) => this.#rpc(channel, handler, request, response) });
      return async () => { dispose(); };
    },
    intercept: (channel: string, matches: (endpoint: string) => boolean, handler: ConnectionHandler): (() => Promise<void>) => {
      if (channel !== "/api") throw new Error(`Invalid shared DSH Connection RPC channel: ${channel}`);
      const registration = { matches, handler }; this.#interceptors.push(registration); let active = true;
      return async () => { if (!active) return; active = false; const index = this.#interceptors.indexOf(registration); if (index >= 0) this.#interceptors.splice(index, 1); };
    },
  };

  readonly fetch = {
    register: (route: { readonly path: string; readonly methods: readonly string[]; readonly fetch: (request: Request) => Promise<Response> }): (() => Promise<void>) => {
      if (!route.path.startsWith("/")) throw new Error(`Unsupported DSH Connection Fetch route: ${route.path}`);
      const dispose = this.routes.register({ kind: "exact", path: route.path, handler: async (request, response) => {
        if (!route.methods.includes(request.method ?? "GET")) { response.writeHead(405); response.end(); return; }
        const target = new URL(request.url ?? route.path, `http://${request.headers.host ?? "localhost"}`);
        const headers = new Headers(); for (const [name, value] of Object.entries(request.headers)) { if (typeof value === "string") headers.set(name, value); else if (Array.isArray(value)) for (const item of value) headers.append(name, item); }
        const result = await route.fetch(new Request(target, { method: request.method ?? "GET", headers }));
        response.writeHead(result.status, Object.fromEntries(result.headers.entries())); response.end(Buffer.from(await result.arrayBuffer()));
      } });
      return async () => { dispose(); };
    },
  };

  async intercept(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
    if (request.method !== "POST" || isCoreApiPath(path)) return false;
    const endpoint = endpointFromPath("/api", path); if (endpoint === undefined) return false;
    const registration = this.#interceptors.find((candidate) => candidate.matches(endpoint)); if (registration === undefined) return false;
    await this.#rpc("/api", registration.handler, request, response); return true;
  }

  async #rpc(channel: string, handler: ConnectionHandler, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
    const endpoint = endpointFromPath(channel, new URL(request.url ?? "/", "http://dsh.internal").pathname);
    if (endpoint === undefined) { response.writeHead(404); response.end(); return; }
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    let body: unknown;
    try { body = JSON.parse(await readRequestText(request, 16 * 1024 * 1024)); }
    catch { this.#envelope(response, "invalid-request", failure("gateway/bad-request", "invalid client-request message")); return; }
    const envelope = body as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown };
    const rpcId = typeof envelope?.rpcId === "string" ? envelope.rpcId : "invalid-request";
    if (envelope?.type !== "client-request" || typeof envelope.rpcId !== "string" || typeof envelope.method !== "string") { this.#envelope(response, rpcId, failure("gateway/bad-request", "invalid client-request message")); return; }
    if (envelope.method !== endpoint) { this.#envelope(response, rpcId, failure("gateway/bad-request", `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`)); return; }
    try { this.#envelope(response, rpcId, await handler(endpoint, envelope.payload, abort.signal)); }
    catch (error) { response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }); response.end(`handler failure: ${error instanceof Error ? error.message : String(error)}`); }
  }

  #envelope(response: ServerResponse, rpcId: string, result: ConnectionResult): void {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify({ type: "server-response", rpcId, result }));
  }
}

function failure(code: string, message: string): ConnectionResult { return { ok: false, error: { code, message, details: { issues: [] } } }; }
function validRoutePath(path: string): boolean { return path.startsWith("/") && path !== "/" && !path.endsWith("/") && !path.includes("?") && !path.includes("#"); }
function isCoreApiPath(path: string): boolean { return /^\/api\/(?:health|models|events|commands|agent-presets|settings|providers|workspaces|attachments|sessions|archived-sessions|approvals|questions|credentials|runs|plugins|dsh)(?:\/|$)/.test(path); }
function assertConnectionChannel(channel: string): void { if (!/^\/[A-Za-z0-9._~-]+$/.test(channel) || channel === "/api") throw new Error(`Invalid DSH Connection RPC channel: ${channel}`); }
function endpointFromPath(channel: string, path: string): string | undefined { const endpoint = path.slice(channel.length + 1); return endpoint && endpoint.split("/").every((part) => /^[A-Za-z0-9_$.-]+$/.test(part) && part !== "." && part !== "..") ? endpoint : undefined; }
async function readRequestText(request: IncomingMessage, limit: number): Promise<string> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const value = Buffer.from(chunk); size += value.byteLength; if (size > limit) throw new Error("request too large"); chunks.push(value); } return Buffer.concat(chunks).toString("utf8"); }
