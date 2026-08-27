import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentServiceToken,
  deriveSessionMessages,
  modelServiceToken,
  sessionId,
  sessionStoreToken,
  text,
  type AgentExecution,
  type JsonObject,
} from "@seal-harness/core";
import { createDefaultProfile } from "@seal-harness/cli";
import type { Profile } from "@seal-harness/host";
import { startProfile } from "@seal-harness/host";
import type { Kernel } from "@seal-harness/kernel";
import type { PiAiBuiltinProvider } from "@seal-harness/provider-pi-ai";
import { WebApprovalService } from "./approval.js";

const PROVIDERS: readonly PiAiBuiltinProvider[] = [
  "anthropic", "deepseek", "google", "groq", "mistral", "openai", "openrouter", "xai",
];
const PROVIDER_SET = new Set<string>(PROVIDERS);
const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = basename(MODULE_ROOT) === "src"
  ? resolve(MODULE_ROOT, "../public")
  : join(MODULE_ROOT, "public");

export interface WebServerOptions {
  readonly cwd: string;
  readonly host?: string;
  readonly port?: number;
  readonly provider?: PiAiBuiltinProvider;
  readonly providers?: readonly PiAiBuiltinProvider[];
  readonly profile?: Profile;
  readonly approvalService?: WebApprovalService;
  readonly credentialEnvironment?: Record<string, string | undefined>;
}

export interface RunningWebServer {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly kernel: Kernel<any>;
  readonly approvalService: WebApprovalService;
  close(): Promise<void>;
}

export async function startWebServer(options: WebServerOptions): Promise<RunningWebServer> {
  const cwd = resolve(options.cwd);
  await assertDirectory(cwd);
  const host = options.host ?? "127.0.0.1";
  const approvalService = options.approvalService ?? new WebApprovalService();
  const credentialEnvironment = options.credentialEnvironment ?? {};
  const profile = options.profile ?? createDefaultProfile({
    cwd,
    provider: options.provider ?? "deepseek",
    providers: options.providers ?? PROVIDERS,
    approvalService,
    credentialEnvironment,
  });
  const kernel = await startProfile(profile);
  const runs = new Map<string, AgentExecution>();
  const server = createServer((request, response) => {
    void dispatch(request, response, {
      cwd, kernel, runs, approvalService, credentialEnvironment,
    }).catch((error) => {
      if (!response.headersSent) json(response, webErrorStatus(error), { error: message(error) });
      else if (!response.writableEnded) response.end();
    });
  });

  try {
    await listen(server, options.port ?? 3080, host);
  } catch (error) {
    approvalService.close(error);
    await kernel.stop();
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Web server has no TCP address");
  const url = `http://${formatHost(host)}:${address.port}`;
  let closed = false;
  return {
    url,
    host,
    port: address.port,
    kernel,
    approvalService,
    async close() {
      if (closed) return;
      closed = true;
      for (const execution of runs.values()) execution.abort(new Error("Web server stopped"));
      approvalService.close();
      await closeServer(server);
      await kernel.stop();
    },
  };
}

interface DispatchContext {
  readonly cwd: string;
  readonly kernel: Kernel<any>;
  readonly runs: Map<string, AgentExecution>;
  readonly approvalService: WebApprovalService;
  readonly credentialEnvironment: Record<string, string | undefined>;
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  context: DispatchContext,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (!isSafeOrigin(request)) {
    json(response, 403, { error: "Cross-origin request rejected" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok", cwd: context.cwd });
    return;
  }
  if (method === "GET" && url.pathname === "/api/models") {
    json(response, 200, await context.kernel.use(modelServiceToken).list());
    return;
  }
  if (method === "GET" && url.pathname === "/api/sessions") {
    const sessions = await context.kernel.use(sessionStoreToken).list();
    json(response, 200, sessions.map((session) => ({
      id: session.id,
      version: session.version,
      cwd: sessionCwd(session),
      updatedAt: session.events.at(-1)?.timestamp,
      preview: preview(deriveSessionMessages(session)),
    })).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))));
    return;
  }
  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && sessionMatch !== null) {
    const value = await context.kernel.use(sessionStoreToken).read(sessionId(decodeURIComponent(sessionMatch[1] ?? "")));
    if (value === undefined) json(response, 404, { error: "Session not found" });
    else json(response, 200, { ...value, messages: deriveSessionMessages(value) });
    return;
  }
  if (method === "GET" && url.pathname === "/api/approvals") {
    json(response, 200, context.approvalService.list());
    return;
  }
  const approvalMatch = /^\/api\/approvals\/([^/]+)$/.exec(url.pathname);
  if (method === "POST" && approvalMatch !== null) {
    const body = await readObject(request);
    if (typeof body.approved !== "boolean") throw new RequestError(400, "approved must be a boolean");
    const decided = context.approvalService.decide(decodeURIComponent(approvalMatch[1] ?? ""), body.approved);
    if (!decided) json(response, 404, { error: "Approval request not found" });
    else json(response, 200, { decided: true });
    return;
  }
  const credentialMatch = /^\/api\/credentials\/([^/]+)$/.exec(url.pathname);
  if (method === "PUT" && credentialMatch !== null) {
    const provider = decodeURIComponent(credentialMatch[1] ?? "");
    if (!PROVIDER_SET.has(provider)) throw new RequestError(400, `Unsupported provider: ${provider}`);
    const body = await readObject(request);
    if (typeof body.apiKey !== "string") throw new RequestError(400, "apiKey must be a string");
    const variable = `${provider.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
    context.credentialEnvironment[variable] = body.apiKey.trim() || undefined;
    json(response, 200, { configured: body.apiKey.trim().length > 0 });
    return;
  }
  if (method === "POST" && url.pathname === "/api/runs") {
    await runAgent(request, response, context);
    return;
  }
  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && runMatch !== null) {
    const run = context.runs.get(decodeURIComponent(runMatch[1] ?? ""));
    if (run === undefined) json(response, 404, { error: "Run not found" });
    else {
      run.abort(new Error("Cancelled from Web UI"));
      json(response, 202, { cancelling: true });
    }
    return;
  }
  if (method === "GET") {
    const asset = staticAsset(url.pathname);
    if (asset !== undefined) {
      const data = await readFile(join(PUBLIC_ROOT, asset.file));
      response.writeHead(200, securityHeaders({
        "content-type": asset.type,
        "cache-control": asset.file === "index.html" ? "no-cache" : "public, max-age=3600",
      }));
      response.end(data);
      return;
    }
  }
  json(response, 404, { error: "Not found" });
}

async function runAgent(
  request: IncomingMessage,
  response: ServerResponse,
  context: DispatchContext,
): Promise<void> {
  const body = await readObject(request);
  const cwd = requiredString(body, "cwd");
  await assertDirectory(cwd);
  const provider = requiredString(body, "provider");
  const model = requiredString(body, "model");
  const prompt = requiredString(body, "prompt");
  const selectedSession = optionalString(body, "sessionId");
  const reasoning = optionalReasoning(body.reasoning);
  const controller = new AbortController();
  const execution = await context.kernel.use(agentServiceToken).prompt({
    cwd: resolve(cwd),
    model: { provider, model },
    prompt: [text(prompt)],
    ...(selectedSession === undefined ? {} : { sessionId: sessionId(selectedSession) }),
    ...(reasoning === undefined ? {} : { reasoning }),
    signal: controller.signal,
  });
  context.runs.set(execution.runId, execution);
  response.writeHead(200, securityHeaders({
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  }));
  response.flushHeaders();
  let disconnected = false;
  response.once("close", () => {
    if (!response.writableEnded) {
      disconnected = true;
      controller.abort(new Error("Web client disconnected"));
    }
  });
  writeLine(response, { type: "started", runId: execution.runId, sessionId: execution.sessionId });
  try {
    for await (const event of execution) writeLine(response, { type: "event", event });
    const completed = await execution.result;
    writeLine(response, {
      type: "completed",
      runId: execution.runId,
      sessionId: execution.sessionId,
      stopReason: completed.runtime.stopReason,
      ...(completed.runtime.errorMessage === undefined ? {} : { errorMessage: completed.runtime.errorMessage }),
    });
  } catch (error) {
    if (!disconnected) writeLine(response, { type: "error", error: message(error) });
  } finally {
    context.runs.delete(execution.runId);
    if (!response.writableEnded) response.end();
  }
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readObject(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_048_576) throw new RequestError(413, "Request body is too large");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new RequestError(400, "Request body must be valid JSON"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestError(400, "Request body must be a JSON object");
  }
  return parsed as JsonObject;
}

function requiredString(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestError(400, `${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new RequestError(400, `${key} must be a string`);
  return value;
}

function optionalReasoning(value: unknown): "off" | "low" | "medium" | "high" | "max" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "off" || value === "low" || value === "medium" || value === "high" || value === "max") return value;
  throw new RequestError(400, "reasoning must be off, low, medium, high, or max");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store",
  }));
  response.end(body);
}

function writeLine(response: ServerResponse, value: unknown): void {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(value)}\n`);
}

function securityHeaders(extra: Record<string, string>): Record<string, string> {
  return {
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra,
  };
}

function isSafeOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === request.headers.host; }
  catch { return false; }
}

function staticAsset(pathname: string): { file: string; type: string } | undefined {
  if (pathname === "/" || pathname === "/index.html") return { file: "index.html", type: "text/html; charset=utf-8" };
  if (pathname === "/app.js") return { file: "app.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/styles.css") return { file: "styles.css", type: "text/css; charset=utf-8" };
  return undefined;
}

function preview(messages: ReturnType<typeof deriveSessionMessages>): string {
  for (const item of messages) {
    if (item.role !== "user") continue;
    const value = item.content.find((block) => block.type === "text");
    if (value?.type === "text") return value.text.slice(0, 120);
  }
  return "New session";
}

function sessionCwd(session: import("@seal-harness/core").SessionSnapshot): string | undefined {
  for (const entry of session.events) {
    if (entry.event.type === "session.created") return entry.event.payload.cwd;
  }
  return undefined;
}

async function assertDirectory(path: string): Promise<void> {
  let value;
  try { value = await stat(resolve(path)); }
  catch { throw new RequestError(400, `Workspace does not exist: ${path}`); }
  if (!value.isDirectory()) throw new RequestError(400, `Workspace is not a directory: ${path}`);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
    server.closeAllConnections();
  });
}

function formatHost(host: string): string { return host.includes(":") ? `[${host}]` : host; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function webErrorStatus(error: unknown): number {
  return error instanceof RequestError ? error.status : 500;
}
