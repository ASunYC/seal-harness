import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentConnection,
  type AgentContext,
  type ContentBlock as AcpContentBlock,
  type InitializeResponse,
  type McpServer,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
  type StopReason,
  type Stream,
} from "@agentclientprotocol/sdk";
import {
  agentServiceToken,
  modelServiceToken,
  toolServiceToken,
  sessionId,
  sessionStoreToken,
  type AgentExecution,
  type ApprovalRequest,
  type ApprovalService,
  type ContentBlock,
  type RuntimeEvent,
  type ModelRef,
  type SessionSnapshot,
} from "@seal-harness/core";
import { startProfile, type Profile } from "@seal-harness/host";
import type { Kernel } from "@seal-harness/kernel";
import { connectMcpServer, registerMcpTools, type McpServerConfig } from "@seal-harness/mcp-client";

export interface AcpServerOptions {
  readonly provider: string;
  readonly model: string;
  readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
  readonly stream?: Stream;
  readonly approvalService?: AcpApprovalService;
  readonly sessionListPageSize?: number;
}

export interface RunningAcpServer {
  readonly connection: AgentConnection;
  readonly kernel: Kernel<any>;
  close(): Promise<void>;
}

interface ActiveSession {
  readonly id: string;
  readonly cwd: string;
  execution?: AgentExecution;
  latestToolCallId?: string;
  disposeMcp?: () => Promise<void>;
  model: ModelRef;
  reasoning?: "off" | "low" | "medium" | "high" | "max";
  configTail: Promise<void>;
}

interface ApprovalContext {
  readonly session: ActiveSession;
}

export class AcpApprovalService implements ApprovalService {
  private readonly storage = new AsyncLocalStorage<ApprovalContext>();
  private requester: ((request: RequestPermissionRequest, signal: AbortSignal) => Promise<boolean>) | undefined;

  attach(context: AgentContext): void {
    this.requester = async (request, signal) => {
      const response = await context.request(methods.client.session.requestPermission, request, {
        cancellationSignal: signal,
      });
      return response.outcome.outcome === "selected" && response.outcome.optionId === "allow-once";
    };
  }

  detach(): void { this.requester = undefined; }

  within<T>(session: ActiveSession, operation: () => Promise<T>): Promise<T> {
    return this.storage.run({ session }, operation);
  }

  async request(request: ApprovalRequest): Promise<boolean> {
    const current = this.storage.getStore();
    if (current === undefined || this.requester === undefined) return false;
    return this.requester({
      sessionId: current.session.id,
      toolCall: {
        toolCallId: current.session.latestToolCallId ?? `approval-${randomUUID()}`,
        title: request.title,
        status: "pending",
        content: [{ type: "content", content: { type: "text", text: request.message } }],
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    }, request.signal);
  }
}

export async function startAcpServer(profile: Profile, options: AcpServerOptions): Promise<RunningAcpServer> {
  const sessionListPageSize = positivePageSize(options.sessionListPageSize ?? 100);
  const kernel = await startProfile(profile);
  const sessions = new Map<string, ActiveSession>();
  const activating = new Set<string>();
  const stream = options.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  let client: AgentContext;
  let closed = false;
  let initialized = false;

  const notify = async (session: ActiveSession, update: SessionUpdate): Promise<void> => {
    const notification: SessionNotification = { sessionId: session.id, update };
    await client.notify(methods.client.session.update, notification);
  };

  const application = agent({ name: "seal-harness-acp" })
    .onRequest(methods.agent.initialize, async () => {
      const response = await initialize(kernel, options);
      initialized = true;
      return response;
    })
    .onRequest(methods.agent.authenticate, async () => ({}))
    .onRequest(methods.agent.session.new, async ({ params }) => {
      assertInitialized(initialized);
      assertWorkspace(params.cwd, params.additionalDirectories);
      const id = randomUUID();
      await kernel.use(sessionStoreToken).create({
        id: sessionId(id), cwd: resolve(params.cwd),
        metadata: { "sealHarness.acpSelection": selectionJson({ provider: options.provider, model: options.model }, options.reasoning) },
      });
      const session: ActiveSession = {
        id, cwd: resolve(params.cwd), model: { provider: options.provider, model: options.model },
        ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }), configTail: Promise.resolve(),
      };
      session.disposeMcp = await mountSessionMcp(kernel, session, params.mcpServers);
      sessions.set(id, session);
      return { sessionId: id, configOptions: await modelConfigOptions(kernel, session) };
    })
    .onRequest(methods.agent.session.list, async ({ params }) => {
      assertInitialized(initialized);
      if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) {
        throw RequestError.invalidParams(undefined, "cwd must be absolute");
      }
      let cursor: SessionListCursor | undefined;
      try { cursor = decodeSessionListCursor(params.cursor); }
      catch { throw RequestError.invalidParams(undefined, "session/list cursor is invalid"); }
      const snapshots = await kernel.use(sessionStoreToken).list();
      const candidates = snapshots.flatMap((snapshot) => {
        const cwd = sessionCwd(snapshot);
        const created = sessionCreated(snapshot);
        if (cwd === undefined || created === undefined || isSubagentSession(snapshot)) return [];
        if (params.cwd !== undefined && params.cwd !== null && resolve(params.cwd) !== resolve(cwd)) return [];
        const key = { createdAt: Date.parse(created.timestamp), sessionId: String(snapshot.id) };
        if (cursor !== undefined && !isAfterSessionListCursor(key, cursor)) return [];
        return [{ snapshot, cwd, key, updatedAt: snapshot.events.at(-1)?.timestamp ?? null }];
      }).sort((left, right) => right.key.createdAt - left.key.createdAt || compareSessionIds(left.key.sessionId, right.key.sessionId));
      const page = candidates.slice(0, sessionListPageSize);
      return {
        sessions: page.map(({ snapshot, cwd, updatedAt }) => ({ sessionId: String(snapshot.id), cwd, updatedAt })),
        ...(candidates.length > page.length && page.at(-1) !== undefined
          ? { nextCursor: encodeSessionListCursor(page.at(-1)!.key) }
          : {}),
      };
    })
    .onRequest(methods.agent.session.resume, async ({ params }) => {
      assertInitialized(initialized);
      assertWorkspace(params.cwd, params.additionalDirectories);
      if (sessions.has(params.sessionId) || activating.has(params.sessionId)) {
        throw RequestError.invalidParams(undefined, `session is already active: ${params.sessionId}`);
      }
      activating.add(params.sessionId);
      try {
        await activateExisting(
          kernel, sessions, params.sessionId, params.cwd,
          { provider: options.provider, model: options.model }, options.reasoning,
        );
        const session = requireSession(sessions, params.sessionId);
        try { session.disposeMcp = await mountSessionMcp(kernel, session, params.mcpServers ?? []); }
        catch (error) { sessions.delete(params.sessionId); throw error; }
        return { configOptions: await modelConfigOptions(kernel, session) };
      } finally {
        activating.delete(params.sessionId);
      }
    })
    .onRequest(methods.agent.session.close, async ({ params }) => {
      assertInitialized(initialized);
      const session = requireSession(sessions, params.sessionId);
      session.execution?.abort(new Error("ACP session closed"));
      await session.configTail;
      await session.disposeMcp?.();
      sessions.delete(params.sessionId);
      return {};
    })
    .onRequest(methods.agent.session.setConfigOption, async ({ params }) => {
      assertInitialized(initialized);
      const session = requireSession(sessions, params.sessionId);
      const result = session.configTail.then(async () => {
        const previous = { model: session.model, reasoning: session.reasoning };
        try {
          await setModelConfig(kernel, session, params.configId, params.value);
          await persistSelection(kernel, session);
        } catch (error) {
          session.model = previous.model;
          if (previous.reasoning === undefined) delete session.reasoning;
          else session.reasoning = previous.reasoning;
          throw error;
        }
      });
      session.configTail = result.then(() => undefined, () => undefined);
      try { await result; }
      catch (error) { throw RequestError.invalidParams(undefined, message(error)); }
      return { configOptions: await modelConfigOptions(kernel, session) };
    })
    .onRequest(methods.agent.session.prompt, async ({ params, signal }) => {
      assertInitialized(initialized);
      const session = requireSession(sessions, params.sessionId);
      if (session.execution !== undefined) throw RequestError.invalidParams(undefined, "a prompt is already running");
      const operation = async (): Promise<PromptResponse> => {
        const execution = await kernel.use(agentServiceToken).prompt({
          sessionId: sessionId(session.id),
          cwd: session.cwd,
          model: session.model,
          prompt: promptContent(params),
          ...(session.reasoning === undefined ? {} : { reasoning: session.reasoning }),
          signal,
        });
        session.execution = execution;
        try {
          for await (const event of execution) await publishEvent(session, event, notify);
          const result = await execution.result;
          return {
            stopReason: stopReason(result.runtime.stopReason),
            ...(result.runtime.usage === undefined ? {} : {
              usage: {
                inputTokens: result.runtime.usage.inputTokens,
                outputTokens: result.runtime.usage.outputTokens,
                totalTokens: result.runtime.usage.totalTokens ?? result.runtime.usage.inputTokens + result.runtime.usage.outputTokens + (result.runtime.usage.cacheReadTokens ?? 0) + (result.runtime.usage.cacheWriteTokens ?? 0),
                ...(result.runtime.usage.reasoningTokens === undefined ? {} : { thoughtTokens: result.runtime.usage.reasoningTokens }),
                ...(result.runtime.usage.cacheReadTokens === undefined ? {} : { cachedReadTokens: result.runtime.usage.cacheReadTokens }),
                ...(result.runtime.usage.cacheWriteTokens === undefined ? {} : { cachedWriteTokens: result.runtime.usage.cacheWriteTokens }),
              },
            }),
          };
        } finally {
          delete session.execution;
          delete session.latestToolCallId;
        }
      };
      return options.approvalService === undefined
        ? operation()
        : options.approvalService.within(session, operation);
    })
    .onNotification(methods.agent.session.cancel, async ({ params }) => {
      sessions.get(params.sessionId)?.execution?.abort(new Error("ACP prompt cancelled"));
    });

  const connection = application.connect(stream);
  client = connection.client;
  options.approvalService?.attach(client);
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const session of sessions.values()) session.execution?.abort(new Error("ACP server stopped"));
    await Promise.all([...sessions.values()].map((session) => session.disposeMcp?.()));
    sessions.clear();
    options.approvalService?.detach();
    connection.close();
    await kernel.stop();
  };
  void connection.closed.catch(() => undefined).then(close);
  return { connection, kernel, close };
}

async function initialize(kernel: Kernel<any>, options: AcpServerOptions): Promise<InitializeResponse> {
  const model = await kernel.use(modelServiceToken).get({ provider: options.provider, model: options.model });
  if (model === undefined) throw new Error(`Unknown model: ${options.provider}/${options.model}`);
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: "seal-harness-acp", version: "0.3.4" },
    agentCapabilities: {
      promptCapabilities: { image: model.supportsImages ?? false, audio: false, embeddedContext: false },
      mcpCapabilities: { http: true },
      sessionCapabilities: { list: {}, resume: {}, close: {} },
    },
    authMethods: [],
  };
}

async function activateExisting(
  kernel: Kernel<any>, sessions: Map<string, ActiveSession>, id: string, cwd: string,
  fallbackModel: ModelRef, fallbackReasoning: ActiveSession["reasoning"],
): Promise<void> {
  if (sessions.has(id)) throw RequestError.invalidParams(undefined, `session is already active: ${id}`);
  const snapshot = await kernel.use(sessionStoreToken).read(sessionId(id));
  if (snapshot === undefined) throw RequestError.invalidParams(undefined, `unknown session: ${id}`);
  const storedCwd = sessionCwd(snapshot);
  if (storedCwd === undefined || resolve(storedCwd) !== resolve(cwd)) {
    throw RequestError.invalidParams(undefined, `session cwd does not match: ${cwd}`);
  }
  const selection = restoredSelection(snapshot, fallbackModel, fallbackReasoning);
  sessions.set(id, { id, cwd: storedCwd, model: selection.model, ...(selection.reasoning === undefined ? {} : { reasoning: selection.reasoning }), configTail: Promise.resolve() });
}

function promptContent(params: PromptRequest): readonly ContentBlock[] {
  return params.prompt.map((block): ContentBlock => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "image", data: block.data, mimeType: block.mimeType };
    if (block.type === "resource" && "text" in block.resource) {
      return { type: "text", text: block.resource.text };
    }
    if (block.type === "resource_link") {
      return { type: "text", text: `[Resource ${block.name}: ${block.uri}]` };
    }
    throw RequestError.invalidParams(undefined, `unsupported prompt content: ${block.type}`);
  });
}

async function publishEvent(
  session: ActiveSession,
  event: RuntimeEvent,
  notify: (session: ActiveSession, update: SessionUpdate) => Promise<void>,
): Promise<void> {
  switch (event.type) {
    case "text_delta":
      await notify(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.delta } });
      break;
    case "reasoning_delta":
      await notify(session, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: event.delta } });
      break;
    case "tool_call":
      session.latestToolCallId = String(event.call.id);
      await notify(session, {
        sessionUpdate: "tool_call", toolCallId: String(event.call.id), title: event.call.name,
        name: event.call.name, kind: toolKind(event.call.name), status: "pending", rawInput: event.call.arguments,
      });
      break;
    case "tool_progress":
      await notify(session, {
        sessionUpdate: "tool_call_update", toolCallId: String(event.callId), status: "in_progress",
        content: event.content.map((content) => ({ type: "content", content: toAcpContent(content) })),
      });
      break;
    case "tool_result":
      await notify(session, {
        sessionUpdate: "tool_call_update", toolCallId: String(event.callId),
        status: event.result.isError ? "failed" : "completed",
        content: event.result.content.map((content) => ({ type: "content", content: toAcpContent(content) })),
      });
      break;
  }
}

function toAcpContent(block: ContentBlock): AcpContentBlock {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") return { type: "image", data: block.data, mimeType: block.mimeType };
  return {
    type: "resource_link", uri: `seal-attachment:${block.id}`, name: block.name ?? block.id,
    ...(block.mimeType === undefined ? {} : { mimeType: block.mimeType }),
  };
}

function stopReason(reason: string): StopReason {
  if (reason === "length") return "max_tokens";
  if (reason === "aborted") return "cancelled";
  return "end_turn";
}

function toolKind(name: string): "read" | "edit" | "search" | "execute" | "other" {
  if (name === "read_file") return "read";
  if (name === "write_file" || name === "edit_file") return "edit";
  if (name === "search" || name === "glob") return "search";
  if (name === "shell" || name.startsWith("terminal_")) return "execute";
  return "other";
}

function requireSession(sessions: Map<string, ActiveSession>, id: string): ActiveSession {
  const session = sessions.get(id);
  if (session === undefined) throw RequestError.invalidParams(undefined, `unknown session: ${id}`);
  return session;
}

function assertInitialized(initialized: boolean): void {
  if (!initialized) throw RequestError.invalidParams(undefined, "ACP connection is not initialized");
}

function assertWorkspace(cwd: string, additional: readonly string[] | undefined): void {
  if (!isAbsolute(cwd)) throw RequestError.invalidParams(undefined, "cwd must be absolute");
  if ((additional?.length ?? 0) > 0) throw RequestError.invalidParams(undefined, "additionalDirectories is not supported");
}

async function mountSessionMcp(
  kernel: Kernel<any>, session: ActiveSession, servers: readonly McpServer[],
): Promise<() => Promise<void>> {
  if (servers.length === 0) return async () => {};
  if (!kernel.has(toolServiceToken)) throw RequestError.invalidParams(undefined, "this Profile has no tool service for MCP");
  const names = new Set<string>();
  const mounted: Array<{ client: Awaited<ReturnType<typeof connectMcpServer>>; disposeTools: Array<() => void> }> = [];
  try {
    for (const server of servers) {
      const config = acpMcpConfig(server, session.cwd);
      const normalized = config.toolPrefix ?? config.id;
      if (names.has(normalized)) throw RequestError.invalidParams(undefined, `duplicate MCP server name: ${normalized}`);
      names.add(normalized);
      const client = await connectMcpServer(config);
      try {
        const disposeTools = await registerMcpTools(client, config, kernel.use(toolServiceToken), {
          ownerSession: sessionId(session.id),
        });
        mounted.push({ client, disposeTools });
      } catch (error) { await client.close(); throw error; }
    }
  } catch (error) {
    await disposeMountedMcp(mounted);
    throw error;
  }
  let active = true;
  return async () => {
    if (!active) return;
    active = false;
    await disposeMountedMcp(mounted);
  };
}

async function disposeMountedMcp(
  mounted: Array<{ client: Awaited<ReturnType<typeof connectMcpServer>>; disposeTools: Array<() => void> }>,
): Promise<void> {
  for (const entry of mounted.reverse()) {
    for (const dispose of entry.disposeTools.reverse()) dispose();
    await entry.client.close();
  }
}

function acpMcpConfig(server: McpServer, cwd: string): McpServerConfig {
  const id = normalizeMcpName(server.name);
  if ("command" in server) {
    if (!isAbsolute(server.command)) throw RequestError.invalidParams(undefined, `MCP server ${server.name} command must be absolute`);
    return { id, toolPrefix: `mcp__${id}`, transport: { type: "stdio", command: server.command, args: server.args, cwd, env: entries(server.env, "environment") } };
  }
  if (server.type === "http") {
    return { id, toolPrefix: `mcp__${id}`, transport: { type: "http", url: server.url, headers: entries(server.headers, "header") } };
  }
  throw RequestError.invalidParams(undefined, `MCP transport ${server.type} is not supported`);
}

function normalizeMcpName(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  if (normalized.length === 0) throw RequestError.invalidParams(undefined, "MCP server name is invalid");
  return normalized;
}

function entries(values: readonly { name: string; value: string }[], kind: string): Record<string, string> {
  const result: Record<string, string> = {};
  const names = new Set<string>();
  for (const entry of values) {
    const identity = kind === "header" ? entry.name.toLowerCase() : entry.name;
    try {
      if (kind === "header") {
        validateHeaderName(entry.name);
        validateHeaderValue(entry.name, entry.value);
      } else if (entry.name.length === 0 || entry.name.includes("=") || entry.name.includes("\0") || entry.value.includes("\0")) {
        throw new Error("invalid environment entry");
      }
    } catch {
      throw RequestError.invalidParams(undefined, `MCP ${kind} entries contain an invalid name or value`);
    }
    if (names.has(identity)) throw RequestError.invalidParams(undefined, `MCP ${kind} entries contain duplicate name: ${entry.name}`);
    names.add(identity);
    result[entry.name] = entry.value;
  }
  return result;
}

async function modelConfigOptions(kernel: Kernel<any>, session: ActiveSession): Promise<SessionConfigOption[]> {
  const catalog = await kernel.use(modelServiceToken).list();
  const groups = new Map<string, Array<{ value: string; name: string }>>();
  for (const model of catalog) {
    const values = groups.get(model.provider) ?? [];
    values.push({ value: modelValue(model), name: model.displayName ?? model.model });
    groups.set(model.provider, values);
  }
  const currentInfo = await kernel.use(modelServiceToken).get(session.model);
  if (currentInfo === undefined) throw new Error(`Unknown model: ${session.model.provider}/${session.model.model}`);
  const options: SessionConfigOption[] = [{
    id: "model", name: "Model", category: "model", type: "select",
    currentValue: modelValue(session.model),
    options: [...groups].map(([provider, values]) => ({ group: provider, name: provider, options: values })),
  }];
  if (currentInfo.supportsReasoning === true) {
    options.push({
      id: "reasoning_effort", name: "Reasoning effort", category: "thought_level", type: "select",
      currentValue: session.reasoning ?? "",
      options: [
        { value: "", name: "Provider default" },
        ...(["off", "low", "medium", "high", "max"] as const).map((value) => ({ value, name: value === "off" ? "Off" : `${value[0]!.toUpperCase()}${value.slice(1)}` })),
      ],
    });
  }
  return options;
}

async function setModelConfig(kernel: Kernel<any>, session: ActiveSession, configId: string, value: unknown): Promise<void> {
  if (typeof value !== "string") throw new Error(`${configId} requires a select value`);
  if (configId === "model") {
    let decoded: unknown;
    try { decoded = JSON.parse(value); } catch { throw new Error(`unknown model option: ${value}`); }
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string") {
      throw new Error(`unknown model option: ${value}`);
    }
    const model = { provider: decoded[0], model: decoded[1] };
    const info = await kernel.use(modelServiceToken).get(model);
    if (info === undefined || modelValue(model) !== value) throw new Error(`unknown model option: ${value}`);
    session.model = model;
    if (info.supportsReasoning !== true) delete session.reasoning;
    return;
  }
  if (configId === "reasoning_effort") {
    const info = await kernel.use(modelServiceToken).get(session.model);
    const allowed = new Set(["", "off", "low", "medium", "high", "max"]);
    if (info?.supportsReasoning !== true || !allowed.has(value)) {
      throw new Error(`unknown reasoning effort for ${session.model.provider}/${session.model.model}: ${value}`);
    }
    if (value === "") delete session.reasoning;
    else session.reasoning = value as Exclude<ActiveSession["reasoning"], undefined>;
    return;
  }
  throw new Error(`unknown session config option: ${configId}`);
}

function modelValue(model: ModelRef): string { return JSON.stringify([model.provider, model.model]); }

function selectionJson(model: ModelRef, reasoning: ActiveSession["reasoning"]): Record<string, string> {
  return { provider: model.provider, model: model.model, ...(reasoning === undefined ? {} : { reasoning }) };
}

function restoredSelection(
  snapshot: SessionSnapshot, fallbackModel: ModelRef, fallbackReasoning: ActiveSession["reasoning"],
): { model: ModelRef; reasoning?: ActiveSession["reasoning"] } {
  let value: unknown;
  for (const entry of snapshot.events) {
    if (entry.event.type === "session.created") value = entry.event.payload.metadata?.["sealHarness.acpSelection"];
    if (entry.event.type === "session.metadata" && "sealHarness.acpSelection" in entry.event.payload.patch) {
      value = entry.event.payload.patch["sealHarness.acpSelection"];
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.provider === "string" && typeof record.model === "string") {
      const reasoning = ["off", "low", "medium", "high", "max"].includes(String(record.reasoning))
        ? record.reasoning as ActiveSession["reasoning"] : undefined;
      return { model: { provider: record.provider, model: record.model }, ...(reasoning === undefined ? {} : { reasoning }) };
    }
  }
  return { model: fallbackModel, ...(fallbackReasoning === undefined ? {} : { reasoning: fallbackReasoning }) };
}

async function persistSelection(kernel: Kernel<any>, session: ActiveSession): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await kernel.use(sessionStoreToken).read(sessionId(session.id));
    if (snapshot === undefined) throw new Error(`unknown session: ${session.id}`);
    try {
      await kernel.use(sessionStoreToken).append({
        id: sessionId(session.id), expectedVersion: snapshot.version,
        events: [{ type: "session.metadata", payload: { patch: { "sealHarness.acpSelection": selectionJson(session.model, session.reasoning) } } }],
      });
      return;
    } catch (error) {
      if (attempt === 2 || !(error instanceof Error) || error.name !== "SessionConflictError") throw error;
    }
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function sessionCwd(snapshot: SessionSnapshot): string | undefined {
  for (const entry of snapshot.events) {
    if (entry.event.type === "session.created") return entry.event.payload.cwd;
  }
  return undefined;
}

interface SessionListCursor { readonly createdAt: number; readonly sessionId: string }

function positivePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("sessionListPageSize must be a positive safe integer");
  return value;
}

function decodeSessionListCursor(value: string | null | undefined): SessionListCursor | undefined {
  if (value === undefined || value === null) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid cursor");
  const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!Array.isArray(decoded) || decoded.length !== 2 || !Number.isSafeInteger(decoded[0]) || decoded[0] < 0 || typeof decoded[1] !== "string" || decoded[1].length === 0) throw new Error("invalid cursor");
  if (Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url") !== value) throw new Error("invalid cursor");
  return { createdAt: decoded[0] as number, sessionId: decoded[1] };
}

function encodeSessionListCursor(value: SessionListCursor): string {
  return Buffer.from(JSON.stringify([value.createdAt, value.sessionId]), "utf8").toString("base64url");
}

function isAfterSessionListCursor(value: SessionListCursor, cursor: SessionListCursor): boolean {
  return value.createdAt < cursor.createdAt || (value.createdAt === cursor.createdAt && compareSessionIds(value.sessionId, cursor.sessionId) > 0);
}

function compareSessionIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sessionCreated(snapshot: SessionSnapshot) {
  return snapshot.events.find((entry) => entry.event.type === "session.created");
}

function isSubagentSession(snapshot: SessionSnapshot): boolean {
  const created = sessionCreated(snapshot);
  return created?.event.type === "session.created" && typeof created.event.payload.metadata?.["sealHarness.parentSessionId"] === "string";
}
