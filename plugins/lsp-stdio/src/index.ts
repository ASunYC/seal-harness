import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { LspError, lspServiceToken, type JsonValue, type LspHover, type LspLocation, type LspOperation, type LspProvider, type LspProviderQuery, type LspQueryResult, type LspRange, type SealHarnessEvents } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface LspServerConfig {
  readonly command: string; readonly args?: readonly string[]; readonly env?: Readonly<Record<string, string>>;
  readonly extensionToLanguage: Readonly<Record<string, string>>; readonly initializationOptions?: JsonValue; readonly configuration?: JsonValue;
  readonly maxMessageBytes?: number; readonly maxStderrBytes?: number; readonly maxDocumentBytes?: number; readonly shutdownTimeoutMs?: number; readonly killGraceMs?: number;
}
export interface LspStdioConfig { readonly servers: Readonly<Record<string, LspServerConfig>> }

export const lspStdioPlugin = definePlugin<LspStdioConfig, SealHarnessEvents>({
  name: "lsp-stdio", requires: [lspServiceToken],
  async setup(context, config) {
    const entries = Object.entries(config.servers ?? {});
    if (entries.length === 0) throw new Error("lsp-stdio requires at least one server");
    const providers = entries.map(([id, value]) => new StdioLspProvider(id, validate(value)));
    const disposers = providers.map((provider) => context.use(lspServiceToken).registerProvider(provider));
    return async () => { for (const dispose of disposers.reverse()) dispose(); await Promise.all(providers.map((provider) => provider.dispose())); };
  },
});

export class StdioLspProvider implements LspProvider {
  readonly extensionToLanguage: Readonly<Record<string, string>>;
  readonly #instances = new Map<string, Promise<LspInstance>>();
  constructor(readonly id: string, readonly config: Required<LspServerConfig>) { this.extensionToLanguage = config.extensionToLanguage; }
  async query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    const source = await sourceDocument(request.workspaceRoot, request.filePath, this.config.maxDocumentBytes);
    let instance = await this.#instance(source.workspace);
    try { return await instance.query(request, source.uri, source.text, signal); }
    catch (error) {
      if (!(error instanceof TransportError) || signal?.aborted) throw error;
      await instance.dispose(); this.#instances.delete(source.workspace);
      instance = await this.#instance(source.workspace);
      return instance.query(request, source.uri, source.text, signal);
    }
  }
  async dispose(): Promise<void> { const all = [...this.#instances.values()]; this.#instances.clear(); await Promise.allSettled(all.map(async (value) => (await value).dispose())); }
  #instance(workspace: string): Promise<LspInstance> {
    let value = this.#instances.get(workspace);
    if (value === undefined) { value = LspInstance.start(workspace, this.config); this.#instances.set(workspace, value); value.catch(() => this.#instances.delete(workspace)); }
    return value;
  }
}

class LspInstance {
  #queue: Promise<unknown> = Promise.resolve();
  private constructor(readonly workspace: string, readonly config: Required<LspServerConfig>, readonly child: ChildProcessWithoutNullStreams, readonly rpc: RpcConnection, readonly capabilities: any) {}
  static async start(workspace: string, config: Required<LspServerConfig>): Promise<LspInstance> {
    const env = scrubbedEnvironment(config.env);
    const child = spawn(config.command, [...config.args], { cwd: workspace, env, shell: false, windowsHide: true });
    const rpc = new RpcConnection(child, config.maxMessageBytes, config.maxStderrBytes, config.configuration);
    try {
    const initialized = await rpc.request("initialize", { processId: null, rootUri: pathToFileURL(workspace).href, workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: workspace.split(/[\\/]/).pop() ?? "workspace" }], capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { definition: { linkSupport: true }, implementation: { linkSupport: true }, hover: { contentFormat: ["markdown", "plaintext"] } }, workspace: { configuration: true, workspaceFolders: true } }, initializationOptions: config.initializationOptions }) as any;
    const capabilities = initialized?.capabilities;
    if (capabilities === null || typeof capabilities !== "object") throw new LspError("language server returned malformed initialize capabilities", "LSP_MALFORMED_RESPONSE");
    if (capabilities.positionEncoding !== undefined && capabilities.positionEncoding !== "utf-16") throw new LspError("language server does not use UTF-16 positions", "LSP_UNSUPPORTED_OPERATION");
    const sync = capabilities.textDocumentSync;
    if (sync === 0 || (sync !== undefined && typeof sync === "object" && sync.openClose === false)) throw new LspError("language server does not support transient document open/close", "LSP_UNSUPPORTED_OPERATION");
    const instance = new LspInstance(workspace, config, child, rpc, capabilities);
    rpc.notify("initialized", {});
    return instance;
    } catch (error) {
      await terminate(child, config.killGraceMs);
      throw error;
    }
  }
  query(request: LspProviderQuery, uri: string, source: string, signal?: AbortSignal): Promise<LspQueryResult> {
    const run = this.#queue.then(() => this.#query(request, uri, source, signal));
    this.#queue = run.catch(() => undefined);
    return run;
  }
  async #query(request: LspProviderQuery, uri: string, source: string, signal?: AbortSignal): Promise<LspQueryResult> {
    signal?.throwIfAborted();
    const capability = ({ goToDefinition: "definitionProvider", findReferences: "referencesProvider", goToImplementation: "implementationProvider", hover: "hoverProvider" } as const)[request.operation];
    if (!this.capabilities[capability]) throw new LspError(`language server does not support ${request.operation}`, "LSP_UNSUPPORTED_OPERATION");
    this.rpc.notify("textDocument/didOpen", { textDocument: { uri, languageId: request.languageId, version: 1, text: source } });
    try {
      const method = operationMethod(request.operation);
      const params = { textDocument: { uri }, position: request.position, ...(request.operation === "findReferences" ? { context: { includeDeclaration: true } } : {}) };
      const value = await this.rpc.request(method, params, signal);
      return request.operation === "hover" ? { kind: "hover", hover: normalizeHover(value) } : { kind: "locations", locations: normalizeLocations(value), resolvedWorkspaceUri: pathToFileURL(this.workspace).href };
    } finally { this.rpc.notify("textDocument/didClose", { textDocument: { uri } }); }
  }
  async dispose(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try { await Promise.race([this.rpc.request("shutdown", null), delay(this.config.shutdownTimeoutMs)]); this.rpc.notify("exit", null); } catch {}
    await terminate(this.child, this.config.killGraceMs);
  }
}

class TransportError extends Error {}
class RpcConnection {
  #buffer = Buffer.alloc(0); #id = 0; #closed: Error | undefined; readonly #pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  #stderr = "";
  constructor(readonly child: ChildProcessWithoutNullStreams, readonly maxMessageBytes: number, readonly maxStderrBytes: number, readonly configuration: JsonValue) {
    child.stdout.on("data", (chunk: Buffer) => this.#receive(chunk));
    child.stderr.on("data", (chunk: Buffer) => { this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-maxStderrBytes); });
    child.once("error", (error) => this.#close(new TransportError(`language server failed: ${error.message}`)));
    child.once("exit", (code, signal) => this.#close(new TransportError(`language server exited (${code ?? signal ?? "unknown"})${this.#stderr === "" ? "" : `: ${this.#stderr}`}`)));
  }
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.#closed !== undefined) return Promise.reject(this.#closed);
    const id = ++this.#id;
    return new Promise((resolvePromise, reject) => {
      const abort = () => { this.notify("$/cancelRequest", { id }); this.#pending.delete(id); reject(signal?.reason ?? new Error("LSP request aborted")); };
      this.#pending.set(id, { resolve: (value) => { signal?.removeEventListener("abort", abort); resolvePromise(value); }, reject: (error) => { signal?.removeEventListener("abort", abort); reject(error); } });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method: string, params: unknown): void { if (this.#closed === undefined) this.#send({ jsonrpc: "2.0", method, params }); }
  #send(value: unknown): void { const body = Buffer.from(JSON.stringify(value)); this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); this.child.stdin.write(body); }
  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (true) {
      const split = this.#buffer.indexOf("\r\n\r\n"); if (split < 0) return;
      const header = this.#buffer.subarray(0, split).toString("ascii"); const match = /(?:^|\r\n)Content-Length: ([0-9]+)(?:\r\n|$)/i.exec(header);
      if (match?.[1] === undefined) { this.#close(new TransportError("malformed LSP frame")); return; }
      const length = Number(match[1]); if (!Number.isSafeInteger(length) || length > this.maxMessageBytes) { this.#close(new TransportError("LSP message exceeds configured limit")); return; }
      const end = split + 4 + length; if (this.#buffer.length < end) return;
      const body = this.#buffer.subarray(split + 4, end); this.#buffer = this.#buffer.subarray(end);
      let message: any; try { message = JSON.parse(body.toString("utf8")); } catch { this.#close(new TransportError("malformed LSP JSON")); return; }
      this.#message(message);
    }
  }
  #message(message: any): void {
    if (typeof message.id === "number" && ("result" in message || "error" in message) && message.method === undefined) {
      const pending = this.#pending.get(message.id); if (pending === undefined) return; this.#pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new LspError(`language server rejected request: ${String(message.error.message ?? "unknown")}`, "LSP_REQUEST_FAILED")); else pending.resolve(message.result); return;
    }
    if (typeof message.method === "string" && message.id !== undefined) {
      const result = message.method === "workspace/configuration" ? (Array.isArray(message.params?.items) ? message.params.items.map(() => this.configuration) : []) : null;
      this.#send({ jsonrpc: "2.0", id: message.id, result });
    }
  }
  #close(error: Error): void { if (this.#closed !== undefined) return; this.#closed = error; for (const pending of this.#pending.values()) pending.reject(error); this.#pending.clear(); }
}

async function sourceDocument(workspaceRoot: string, filePath: string, maxBytes: number): Promise<{ workspace: string; uri: string; text: string }> {
  let workspace: string; let path: string;
  try { workspace = await realpath(workspaceRoot); const candidate = resolve(workspace, filePath); path = await realpath(candidate); }
  catch { throw new LspError("LSP source or workspace does not exist", "LSP_INVALID_SOURCE"); }
  const rel = relative(workspace, path); if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new LspError("LSP source is outside the workspace", "LSP_SOURCE_OUTSIDE_WORKSPACE");
  const info = await stat(path); if (!info.isFile()) throw new LspError("LSP source is not a regular file", "LSP_INVALID_SOURCE"); if (info.size > maxBytes) throw new LspError("LSP source exceeds configured limit", "LSP_INVALID_SOURCE");
  const data = await readFile(path); let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { throw new LspError("LSP source is not valid UTF-8", "LSP_INVALID_SOURCE"); }
  return { workspace, uri: pathToFileURL(path).href, text };
}
function operationMethod(value: LspOperation): string { return ({ goToDefinition: "textDocument/definition", findReferences: "textDocument/references", goToImplementation: "textDocument/implementation", hover: "textDocument/hover" } as const)[value]; }
function normalizeLocations(value: unknown): LspLocation[] { if (value === null) return []; const items = Array.isArray(value) ? value : [value]; return items.map((item) => { const x = item as any; const uri = x.uri ?? x.targetUri; const range = x.range ?? x.targetSelectionRange; if (typeof uri !== "string" || !validRange(range)) throw new LspError("language server returned malformed locations", "LSP_MALFORMED_RESPONSE"); return { uri, range }; }); }
function normalizeHover(value: unknown): LspHover | null { if (value === null) return null; const item = value as any; const contents = hoverText(item?.contents); if (contents === undefined || (item.range !== undefined && !validRange(item.range))) throw new LspError("language server returned malformed hover", "LSP_MALFORMED_RESPONSE"); return { contents, ...(item.range === undefined ? {} : { range: item.range }) }; }
function hoverText(value: unknown): string | undefined { if (typeof value === "string") return value; if (value !== null && typeof value === "object" && !Array.isArray(value)) { const x = value as any; if (typeof x.value === "string") return typeof x.language === "string" ? `\`\`\`${x.language}\n${x.value}\n\`\`\`` : x.value; } if (Array.isArray(value)) { const parts = value.map(hoverText); return parts.every((x) => x !== undefined) ? parts.join("\n\n") : undefined; } return undefined; }
function validRange(value: any): value is LspRange { return validPosition(value?.start) && validPosition(value?.end); }
function validPosition(value: any): boolean { return Number.isSafeInteger(value?.line) && value.line >= 0 && Number.isSafeInteger(value?.character) && value.character >= 0; }
function scrubbedEnvironment(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv { const env: NodeJS.ProcessEnv = {}; for (const [key, value] of Object.entries(process.env)) if (!/^(?:DSH_|SEAL_HARNESS_)|KEY|PASSWORD|SECRET|TOKEN/i.test(key) && value !== undefined) env[key] = value; return { ...env, ...extra }; }
function validate(value: LspServerConfig): Required<LspServerConfig> { if (value.command.trim() === "") throw new Error("LSP command must be non-empty"); const number = (x: number | undefined, fallback: number, name: string) => { const result = x ?? fallback; if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive safe integer`); return result; }; return { command: value.command, args: value.args ?? [], env: value.env ?? {}, extensionToLanguage: value.extensionToLanguage, initializationOptions: value.initializationOptions ?? null, configuration: value.configuration ?? null, maxMessageBytes: number(value.maxMessageBytes, 16_000_000, "maxMessageBytes"), maxStderrBytes: number(value.maxStderrBytes, 1_000_000, "maxStderrBytes"), maxDocumentBytes: number(value.maxDocumentBytes, 4_000_000, "maxDocumentBytes"), shutdownTimeoutMs: number(value.shutdownTimeoutMs, 5_000, "shutdownTimeoutMs"), killGraceMs: number(value.killGraceMs, 2_000, "killGraceMs") }; }
function delay(ms: number): Promise<void> { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
async function terminate(child: ChildProcessWithoutNullStreams, grace: number): Promise<void> { if (child.exitCode !== null || child.signalCode !== null) return; child.kill("SIGTERM"); await Promise.race([new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())), delay(grace)]); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
