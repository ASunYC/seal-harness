import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { JsonObject, JsonValue, RuntimeEvent } from "@seal-harness/core";
import { disposeRuntimeProcess } from "./dispose.js";

export interface SealHarnessOptions {
  readonly cwd?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  /** DeepSeek Harness-compatible name for `reasoning`. Takes precedence when both are present. */
  readonly reasoningEffort?: "off" | "low" | "medium" | "high" | "max";
  readonly maxTokens?: number;
  readonly configPath?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly initializeTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly disposeEofGraceMs?: number;
  readonly disposeGraceMs?: number;
}

export interface RpcNotification {
  readonly method: string;
  readonly params: JsonObject;
}

export type NotificationFilter = (notification: RpcNotification) => boolean;

export class SdkTransportClosedError extends Error {
  override readonly name = "SdkTransportClosedError";
}

export interface NotificationSubscription extends AsyncIterable<RpcNotification> {
  next(): Promise<RpcNotification>;
  tryNext(): RpcNotification | undefined;
  close(): void;
}

export interface RunOptions {
  readonly sessionId?: string;
  readonly onNotification?: (notification: RpcNotification) => void;
}

export interface RunResult {
  readonly sessionId: string;
  readonly runId: string;
  readonly finalResponse: string;
  readonly finishReason: string;
  readonly events: readonly RuntimeEvent[];
  readonly notifications: readonly RpcNotification[];
}

export class SealHarness implements AsyncDisposable {
  readonly cwd: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: SealHarnessOptions["reasoning"];
  readonly maxTokens: number | undefined;
  private clientInstance: RpcProcessClient;
  private readonly createClient: () => RpcProcessClient;
  private initialized: Promise<void> | undefined;
  private closed = false;

  constructor(options: SealHarnessOptions = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.provider = options.provider ?? "deepseek";
    this.model = options.model ?? "deepseek-chat";
    this.reasoning = options.reasoningEffort ?? options.reasoning;
    this.maxTokens = optionalPositiveInteger(options.maxTokens, "maxTokens");
    this.createClient = () => new RpcProcessClient(options);
    this.clientInstance = this.createClient();
  }

  /** The low-level client currently owning the runtime subprocess. */
  get client(): RpcProcessClient { return this.clientInstance; }

  async start(): Promise<void> {
    if (this.closed) throw new Error("Seal Harness SDK client is closed");
    this.initialized ??= (async () => {
      this.clientInstance.start();
      await this.clientInstance.request("initialize", {
        cwd: this.cwd,
        provider: this.provider,
        model: this.model,
        ...(this.reasoning === undefined ? {} : { reasoningEffort: this.reasoning }),
        ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
      }, undefined, this.clientInstance.initializeTimeoutMs);
    })();
    try { await this.initialized; }
    catch (error) {
      this.initialized = undefined;
      try { await this.clientInstance.close(); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Seal Harness initialization and cleanup failed");
      }
      if (!this.closed) this.clientInstance = this.createClient();
      throw error;
    }
  }

  session(id = `session-${randomUUID().replaceAll("-", "")}`): HarnessSession {
    return new HarnessSession(this, id);
  }

  run(prompt: string, options: RunOptions = {}): Promise<RunResult> {
    return this.session(options.sessionId).run(prompt, options);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.clientInstance.close();
  }
  async [Symbol.asyncDispose](): Promise<void> { await this.close(); }

  async runSession(sessionId: string, prompt: string, options: RunOptions): Promise<RunResult> {
    await this.start();
    const events: RuntimeEvent[] = [];
    const notifications: RpcNotification[] = [];
    const result = asRecord(await this.clientInstance.request("prompt", {
      cwd: this.cwd,
      provider: this.provider,
      model: this.model,
      prompt,
      sessionId,
      ...(this.reasoning === undefined ? {} : { reasoning: this.reasoning }),
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    }, (notification) => {
      notifications.push(notification);
      options.onNotification?.(notification);
      if (notification.method === "event" && isRecord(notification.params.event)) {
        events.push(notification.params.event as unknown as RuntimeEvent);
      }
    }));
    return {
      sessionId: requiredString(result.sessionId, "sessionId"),
      runId: requiredString(result.runId, "runId"),
      finishReason: requiredString(result.stopReason, "stopReason"),
      finalResponse: events
        .filter((event): event is Extract<RuntimeEvent, { type: "text_delta" }> => event.type === "text_delta")
        .map((event) => event.delta).join(""),
      events,
      notifications,
    };
  }
}

function optionalPositiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export class HarnessSession {
  constructor(readonly harness: SealHarness, readonly id: string) {}
  run(prompt: string, options: Omit<RunOptions, "sessionId"> = {}): Promise<RunResult> {
    return this.harness.runSession(this.id, prompt, options);
  }
}

interface PendingRequest {
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
  readonly onNotification?: (notification: RpcNotification) => void;
  readonly timer?: NodeJS.Timeout;
}

interface SubscriptionState {
  readonly queue: RpcNotification[];
  readonly waiters: Array<{ resolve: (notification: RpcNotification) => void; reject: (error: Error) => void }>;
  readonly filter: NotificationFilter | undefined;
  failure: Error | undefined;
}

class NotificationSubscriptionImpl implements NotificationSubscription {
  constructor(readonly state: SubscriptionState, readonly unsubscribe: () => void) {}
  next(): Promise<RpcNotification> {
    const queued = this.state.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.state.failure !== undefined) return Promise.reject(this.state.failure);
    return new Promise((resolvePromise, reject) => this.state.waiters.push({ resolve: resolvePromise, reject }));
  }
  tryNext(): RpcNotification | undefined { return this.state.queue.shift(); }
  close(): void {
    this.unsubscribe(); this.state.queue.length = 0;
    const error = new SdkTransportClosedError("Notification subscription closed");
    this.state.failure = error;
    for (const waiter of this.state.waiters.splice(0)) waiter.reject(error);
  }
  fail(error: Error): void {
    this.state.failure ??= error;
    for (const waiter of this.state.waiters.splice(0)) waiter.reject(this.state.failure);
  }
  push(notification: RpcNotification): void {
    let matches: boolean;
    try { matches = this.state.filter === undefined || this.state.filter(notification); }
    catch (error) { this.unsubscribe(); this.fail(error instanceof Error ? error : new Error(String(error))); return; }
    if (!matches || this.state.failure !== undefined) return;
    const waiter = this.state.waiters.shift();
    if (waiter === undefined) this.state.queue.push(notification); else waiter.resolve(notification);
  }
  async *[Symbol.asyncIterator](): AsyncIterator<RpcNotification> { for (;;) yield await this.next(); }
}

export class RpcProcessClient {
  readonly initializeTimeoutMs: number;
  private readonly requestTimeoutMs: number | undefined;
  private readonly shutdownTimeoutMs: number;
  private readonly disposeEofGraceMs: number;
  private readonly disposeGraceMs: number;
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string | undefined;
  private readonly environment: Readonly<NodeJS.ProcessEnv> | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stderr: string[] = [];
  private readonly subscriptions = new Map<number, NotificationSubscriptionImpl>();
  private readonly sessionParents = new Map<string, string>();
  private subscriptionSerial = 0;
  private terminalFailure: Error | undefined;
  private closeTask: Promise<void> | undefined;
  private closed = false;

  constructor(options: SealHarnessOptions) {
    this.initializeTimeoutMs = positiveTimeout(options.initializeTimeoutMs, 10_000, "initializeTimeoutMs");
    this.requestTimeoutMs = options.requestTimeoutMs === undefined ? undefined : positiveTimeout(options.requestTimeoutMs, 0, "requestTimeoutMs");
    this.shutdownTimeoutMs = positiveTimeout(options.shutdownTimeoutMs, 1_000, "shutdownTimeoutMs");
    this.disposeEofGraceMs = positiveTimeout(options.disposeEofGraceMs, 6_000, "disposeEofGraceMs");
    this.disposeGraceMs = positiveTimeout(options.disposeGraceMs, 3_000, "disposeGraceMs");
    this.command = options.command ?? process.execPath;
    const rpcBin = fileURLToPath(import.meta.resolve("@seal-harness/rpc/bin"));
    this.args = options.args === undefined
      ? [rpcBin, "--cwd", resolve(options.cwd ?? process.cwd()), "--provider", options.provider ?? "deepseek",
          ...(options.configPath === undefined ? [] : ["--config", options.configPath])]
      : [...options.args];
    this.cwd = options.cwd === undefined ? undefined : resolve(options.cwd);
    this.environment = options.environment;
  }

  start(): void {
    if (this.closed) throw new Error("Seal Harness SDK client is closed");
    if (this.child !== undefined) return;
    const child = spawn(this.command, this.args, {
      ...(this.cwd === undefined ? {} : { cwd: this.cwd }),
      env: { ...(this.environment ?? process.env) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr.push(chunk);
      if (this.stderr.length > 100) this.stderr.shift();
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    child.once("error", (error) => { this.terminalFailure = error; this.failAll(error); this.failSubscriptions(error); });
    child.once("exit", (code, signal) => {
      const error = new SdkTransportClosedError(`Seal Harness RPC exited (${code ?? signal ?? "unknown"})${this.diagnostics()}`);
      this.terminalFailure = error; this.failAll(error); this.failSubscriptions(error);
    });
  }

  request(
    method: string,
    params: JsonObject,
    onNotification?: (notification: RpcNotification) => void,
    timeoutMs: number | undefined = this.requestTimeoutMs,
  ): Promise<JsonValue> {
    if (timeoutMs !== undefined) positiveTimeout(timeoutMs, 0, "timeoutMs");
    this.start();
    const child = this.child;
    if (child === undefined) return Promise.reject(new Error("Seal Harness RPC did not start"));
    const id = this.nextId++;
    return new Promise<JsonValue>((resolvePromise, reject) => {
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms${this.diagnostics()}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolvePromise, reject,
        ...(timer === undefined ? {} : { timer }),
        ...(onNotification === undefined ? {} : { onNotification }),
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (error === null || error === undefined) return;
        const pending = this.pending.get(id);
        if (pending === undefined) return;
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  subscribe(filter?: NotificationFilter): NotificationSubscription {
    const id = this.subscriptionSerial++;
    const state: SubscriptionState = { queue: [], waiters: [], filter, failure: undefined };
    const subscription = new NotificationSubscriptionImpl(state, () => this.subscriptions.delete(id));
    if (this.closed || this.terminalFailure !== undefined) subscription.fail(this.terminalFailure ?? new SdkTransportClosedError("Seal Harness SDK client closed"));
    else this.subscriptions.set(id, subscription);
    return subscription;
  }

  subscribeSessionTree(sessionId: string): NotificationSubscription {
    return this.subscribe((notification) => {
      const params = notification.params;
      if (notification.method === "subagent.started" || notification.method === "subagent.finished") {
        const parent = params.parentSessionId;
        return (typeof parent === "string" && this.isDescendantOf(parent, sessionId)) || params.childSessionId === sessionId;
      }
      return typeof params.sessionId === "string" && this.isDescendantOf(params.sessionId, sessionId);
    });
  }

  close(): Promise<void> { this.closeTask ??= this.performClose(); return this.closeTask; }

  private async performClose(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child === undefined) { for (const subscription of [...this.subscriptions.values()]) subscription.close(); return; }
    try { await this.requestWhileClosing("shutdown", {}, this.shutdownTimeoutMs); }
    catch { /* bounded best-effort shutdown */ }
    await disposeRuntimeProcess(child, { disposeEofGraceMs: this.disposeEofGraceMs, disposeGraceMs: this.disposeGraceMs });
    this.child = undefined;
    this.terminalFailure = new SdkTransportClosedError("Seal Harness SDK client closed");
    this.failAll(this.terminalFailure);
    for (const subscription of [...this.subscriptions.values()]) subscription.close();
  }

  private requestWhileClosing(method: string, params: JsonObject, timeoutMs: number): Promise<JsonValue> {
    this.closed = false;
    const result = this.request(method, params, undefined, timeoutMs);
    this.closed = true;
    return result;
  }

  private receive(line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    if (!isRecord(value)) return;
    if (typeof value.method === "string" && isRecord(value.params)) {
      const notification = { method: value.method, params: value.params as JsonObject };
      this.recordSessionRelationship(notification);
      for (const subscription of this.subscriptions.values()) subscription.push(notification);
      const requestId = value.params.requestId;
      if (typeof requestId === "number") this.pending.get(requestId)?.onNotification?.(notification);
      return;
    }
    if (typeof value.id !== "number") return;
    const pending = this.pending.get(value.id);
    if (pending === undefined) return;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    this.pending.delete(value.id);
    if (typeof value.error === "string") pending.reject(new Error(`${value.error}${this.diagnostics()}`));
    else if (isRecord(value.error) && typeof value.error.message === "string") pending.reject(Object.assign(new Error(`${value.error.message}${this.diagnostics()}`), { code: value.error.code, data: value.error.data }));
    else pending.resolve(value.result as JsonValue);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private failSubscriptions(error: Error): void { for (const subscription of this.subscriptions.values()) subscription.fail(error); }
  private recordSessionRelationship(notification: RpcNotification): void {
    if (notification.method !== "subagent.started") return;
    const parent = notification.params.parentSessionId; const child = notification.params.childSessionId;
    if (typeof parent === "string" && parent !== "" && typeof child === "string" && child !== "" && parent !== child) this.sessionParents.set(child, parent);
  }
  private isDescendantOf(sessionId: string, root: string): boolean {
    const visited = new Set<string>(); let current = sessionId;
    while (!visited.has(current)) { if (current === root) return true; visited.add(current); const parent = this.sessionParents.get(current); if (parent === undefined) return false; current = parent; }
    return false;
  }

  private diagnostics(): string {
    const value = this.stderr.join("").trim();
    return value === "" ? "" : `\nRPC stderr:\n${value}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: JsonValue): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("RPC result must be an object");
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`RPC result ${name} must be a non-empty string`);
  return value;
}

function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer`);
  return resolved;
}
