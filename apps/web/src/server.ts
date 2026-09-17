import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzip } from "node:zlib";
import sharp from "sharp";
import { liveAssistantPreview } from "./live-assistant.js";
import {
  agentServiceToken,
  foldSessionInbox,
  reviewServiceToken,
  policyServiceToken,
  agentPresetServiceToken,
  attachmentServiceToken,
  commandServiceToken,
  credentialServiceToken,
  deriveSessionMessages,
  foldSessionSurface,
  modelServiceToken,
  messageFeedbackServiceToken,
  messageId,
  MessageFeedbackError,
  planModeServiceToken,
  permissionPresetServiceToken,
  goalServiceToken,
  GoalError,
  todoServiceToken,
  jobServiceToken,
  terminalServiceToken,
  teamServiceToken,
  scheduleServiceToken,
  webRouteServiceToken,
  subagentServiceToken,
  sessionId,
  sessionStoreToken,
  settingsServiceToken,
  SettingsConflictError,
  text,
  type AgentExecution,
  type AttachmentBlock,
  type ContentBlock,
  type JsonObject,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { createDefaultProfile } from "@seal-harness/cli";
import { dshCompatPlugin, dshCompatServiceToken, type DshPluginSource } from "@seal-harness/dsh-compat";
import { DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES, DEFAULT_FILE_SEARCH_MAX_ENTRIES, DEFAULT_FILE_SEARCH_MAX_RESULTS, WorkspaceFileSearch } from "@deepseek-ai/dsh-file-reference-local";
import { canOpenNativePath, openNativePath, openNativeTextFile } from "@deepseek-ai/dsh-native-command";
import { normalizeSessionTitle } from "@deepseek-ai/dsh-session-title";
import { defineProfile, startProfile, type Profile } from "@seal-harness/host";
import { definePlugin, plugin, type Kernel } from "@seal-harness/kernel";
import { PluginProfileManager } from "@seal-harness/plugin-manager";
import {
  discoverProviderModels,
  PiAiModelService,
  piAiBuiltinProviders,
  type PiAiBuiltinProvider,
  type PiAiCustomProvider,
  type PiAiProviderApi,
} from "@seal-harness/provider-pi-ai";
import { WebApprovalService } from "./approval.js";
import { WebQuestionAnswerer } from "./questions.js";
import { DshConnectionBridge, WebRouteRegistry } from "./plugin-host.js";
import { DshWorkspaceRegistryBridge, WorkspaceNotFoundError, WorkspaceRegistry } from "./workspaces.js";
import { WebAuthenticator } from "./auth.js";
import { dshHistoryPage, dshSessionMetrics, dshWireHistory, type DshAttachmentMetadata } from "./dsh-session-history.js";
import { DshRemoteStreamMux } from "./remote-stream.js";
import { DshRemoteEventGateway } from "./remote-events.js";
import { commandMessageViews, compactionMessageViews, modelRetryMessageViews, referenceLabelsByMessageSequence, steeringMessageSequences, systemPromptMessageViews, transcriptNodeSequences, turnErrorMessageViews, turnMaxTokensMessageViews, turnTailMessageViews, unknownSurfaceMessageViews, workflowRunMessageViews, type CommandMessageView, type CompactionMessageView, type ModelRetryMessageView, type SystemPromptMessageView, type TurnErrorMessageView, type TurnMaxTokensMessageView, type TurnTailMessageView, type UnknownSurfaceMessageView, type WorkflowRunMessageView } from "./message-classification.js";

const PROVIDERS: readonly PiAiBuiltinProvider[] = piAiBuiltinProviders;
const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const KATEX_ROOT = dirname(fileURLToPath(import.meta.resolve("katex")));
const HIGHLIGHT_MODULE = fileURLToPath(import.meta.resolve("@highlightjs/cdn-assets/es/highlight.min.js"));
const HIGHLIGHT_STYLE = fileURLToPath(import.meta.resolve("@highlightjs/cdn-assets/styles/github-dark.min.css"));
const PUBLIC_ROOT = basename(MODULE_ROOT) === "src"
  ? resolve(MODULE_ROOT, "../public")
  : join(MODULE_ROOT, "public");
const ROOT_CLIENT_MODULES = new Set(readdirSync(PUBLIC_ROOT).filter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*\.js$/.test(name)));
const gzipResponse = promisify(gzip);
const COMPRESSION_THRESHOLD_BYTES = 1_024;

class WebEventStream {
  readonly #clients = new Set<ServerResponse>();
  readonly #listeners = new Set<(type: keyof SealHarnessEvents & string, payload: unknown) => void>();

  connect(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");
    this.#clients.add(response);
    request.once("close", () => this.#clients.delete(response));
  }

  publish(type: keyof SealHarnessEvents & string, payload: unknown): void {
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of [...this.#clients]) {
      if (response.destroyed || response.writableEnded) this.#clients.delete(response);
      else response.write(frame);
    }
    for (const listener of [...this.#listeners]) listener(type, payload);
  }

  subscribe(listener: (type: keyof SealHarnessEvents & string, payload: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    for (const response of this.#clients) response.end();
    this.#clients.clear();
    this.#listeners.clear();
  }
}

class DshControlHub {
  readonly #listeners = new Set<(frame: unknown) => void>();
  readonly #runs = new Map<string, () => void>();
  #disposeJobs: (() => void) | undefined;
  #disposeProjections: (() => void) | undefined;
  readonly #projectionChains = new Map<string, Promise<void>>();
  readonly #parked = new Map<string, import("@seal-harness/core").PendingAgentMessage[]>();

  subscribe(listener: (frame: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  track(execution: AgentExecution): void {
    this.#runs.get(execution.runId)?.();
    const publish = (messages: readonly import("@seal-harness/core").PendingAgentMessage[]) => this.publish({ type: "queue", sessionId: execution.sessionId, items: dshQueueItems(messages) });
    const dispose = execution.subscribePending?.(publish) ?? (() => {});
    this.#runs.set(execution.runId, dispose);
    publish(execution.pendingMessages?.() ?? []);
    void execution.result.finally(() => {
      if (this.#runs.get(execution.runId) !== dispose) return;
      dispose(); this.#runs.delete(execution.runId);
      const remaining = [...(execution.pendingMessages?.() ?? [])];
      if (remaining.length === 0) this.#parked.delete(execution.sessionId); else this.#parked.set(execution.sessionId, remaining);
      this.publish({ type: "queue", sessionId: execution.sessionId, items: dshQueueItems(remaining) });
    }).catch(() => undefined);
  }

  pending(session: string): readonly import("@seal-harness/core").PendingAgentMessage[] { return this.#parked.get(session) ?? []; }

  take(session: string): readonly import("@seal-harness/core").PendingAgentMessage[] {
    const values = this.#parked.get(session) ?? [];
    if (values.length > 0) { this.#parked.delete(session); this.publish({ type: "queue", sessionId: session, items: [] }); }
    return values;
  }

  restore(session: string, values: readonly import("@seal-harness/core").PendingAgentMessage[]): void {
    if (values.length === 0) return;
    this.#parked.set(session, [...values]); this.publish({ type: "queue", sessionId: session, items: dshQueueItems(values) });
  }

  updateParked(session: string, id: import("@seal-harness/core").MessageId, action: import("@seal-harness/core").PendingMessageAction): import("@seal-harness/core").PendingMessageUpdate {
    const values = this.#parked.get(session); if (values === undefined) return "not-found";
    const index = values.findIndex((entry) => entry.id === id); const current = values[index]; if (current === undefined) return "not-found";
    if (action.kind === "steer" && current.placement !== "queued") return "steer-unavailable";
    if (action.kind === "edit") values[index] = { ...current, message: { ...current.message, content: action.content } };
    else if (action.kind === "remove") values.splice(index, 1);
    else values[index] = { ...current, placement: "steering" };
    if (values.length === 0) this.#parked.delete(session);
    this.publish({ type: "queue", sessionId: session, items: dshQueueItems(values) });
    return "updated";
  }

  trackJobs(service: import("@seal-harness/core").JobService): void {
    this.#disposeJobs?.();
    this.#disposeJobs = service.subscribe?.((owner) => {
      if (owner !== undefined) this.publish({ type: "jobs", sessionId: owner, jobs: dshJobs(service.list(owner).filter((job) => job.ownerSession === owner)) });
    });
  }

  trackProjections(events: WebEventStream, store: import("@seal-harness/core").SessionStore, imageLimits?: import("@seal-harness/core").ImageAttachmentLimits): void {
    this.#disposeProjections?.();
    this.#disposeProjections = events.subscribe((type, payload) => {
      if (type !== "session.appended" || payload === null || typeof payload !== "object" || typeof (payload as { sessionId?: unknown }).sessionId !== "string") return;
      const id = (payload as { sessionId: string }).sessionId;
      const previous = this.#projectionChains.get(id) ?? Promise.resolve();
      const next = previous.then(async () => {
        const session = await store.read(sessionId(id)); if (session === undefined) return;
        const baseline = dshProjectionBaseline(session, imageLimits) as { asOfSeq: number; values: Record<string, unknown> };
        for (const [key, value] of Object.entries(baseline.values)) this.publish({ type: "projection", sessionId: id, key, value, seq: baseline.asOfSeq });
      }).catch(() => undefined).finally(() => { if (this.#projectionChains.get(id) === next) this.#projectionChains.delete(id); });
      this.#projectionChains.set(id, next);
    });
  }

  publish(frame: unknown): void { for (const listener of [...this.#listeners]) listener(frame); }

  close(): void {
    for (const dispose of this.#runs.values()) dispose();
    this.#runs.clear(); this.#parked.clear(); this.#disposeJobs?.(); this.#disposeJobs = undefined; this.#disposeProjections?.(); this.#disposeProjections = undefined; this.#projectionChains.clear(); this.#listeners.clear();
  }
}

export interface WebServerOptions {
  readonly cwd: string;
  /** Optional application-wide persistence root, independent of workspace cwd. */
  readonly dataHome?: string;
  readonly host?: string;
  readonly port?: number;
  readonly provider?: PiAiBuiltinProvider;
  readonly providers?: readonly PiAiBuiltinProvider[];
  readonly customProviders?: readonly PiAiCustomProvider[];
  readonly profile?: Profile;
  readonly approvalService?: WebApprovalService;
  readonly questionAnswerer?: WebQuestionAnswerer;
  readonly credentialEnvironment?: Record<string, string | undefined>;
  readonly pluginHome?: string;
  readonly pluginProfile?: string;
  /** Enable reusable plugin services; execution remains owned by Seal/Pi. */
  readonly dshCompatibility?: boolean;
  readonly workspaceRegistryPath?: string;
  readonly authenticate?: boolean;
  readonly authCredentialPath?: string;
}

export interface RunningWebServer {
  readonly url: string;
  readonly launchUrl: string;
  readonly host: string;
  readonly port: number;
  readonly kernel: Kernel<any>;
  readonly approvalService: WebApprovalService;
  readonly questionAnswerer: WebQuestionAnswerer;
  close(): Promise<void>;
}

export async function startWebServer(options: WebServerOptions): Promise<RunningWebServer> {
  const cwd = resolve(options.cwd);
  await assertDirectory(cwd);
  const host = options.host ?? "127.0.0.1";
  const approvalService = options.approvalService ?? new WebApprovalService();
  const questionAnswerer = options.questionAnswerer ?? new WebQuestionAnswerer();
  const credentialEnvironment = options.credentialEnvironment ?? {};
  const authenticator = options.authenticate === true
    ? new WebAuthenticator(options.authCredentialPath ?? join(options.dataHome ?? options.pluginHome ?? join(cwd, ".seal-harness"), "web-auth-token"))
    : undefined;
  await authenticator?.start();
  const manager = new PluginProfileManager({
    ...(options.pluginHome === undefined ? {} : { home: options.pluginHome }),
    profile: options.pluginProfile ?? "web",
  });
  const installedHostPlugins = await manager.loadHostPlugins();
  const routes = new WebRouteRegistry(isLoopbackHost(host) ? "127.0.0.1" : "0.0.0.0");
  const connection = new DshConnectionBridge(routes, (request) => {
    if (!isSafeOrigin(request)) return 403;
    return authenticator !== undefined && !authenticator.isAuthenticated(request) ? 401 : undefined;
  });
  const remoteEvents = new DshRemoteEventGateway();
  const disposeRemoteEventResults = connection.rpc.intercept("/api", (endpoint) => endpoint === "$events/result", async (_endpoint, payload) => remoteEvents.result(payload));
  const webEvents = new WebEventStream();
  const eventBridge = definePlugin<undefined, SealHarnessEvents>({
    name: "web-event-bridge",
    setup(context) {
      context.on("models.updated", (payload) => webEvents.publish("models.updated", payload));
      context.on("settings.updated", (payload) => webEvents.publish("settings.updated", payload));
      context.on("session.appended", (payload) => webEvents.publish("session.appended", payload));
    },
  });
  const baseProfile = options.profile ?? createDefaultProfile({
    cwd,
    ...(options.dataHome === undefined ? {} : { dataHome: options.dataHome }),
    provider: options.provider ?? "deepseek",
    providers: options.providers ?? PROVIDERS,
    ...(options.customProviders === undefined ? {} : { customProviders: options.customProviders }),
    approvalService,
    questionAnswerer: questionAnswerer.answer,
    credentialEnvironment,
  });
  const hasAttachmentProvider = baseProfile.some((entry) => entry.plugin.provides?.includes(attachmentServiceToken) === true);
  const hasFeedbackProvider = baseProfile.some((entry) => entry.plugin.provides?.includes(messageFeedbackServiceToken) === true);
  const hasSessionProvider = baseProfile.some((entry) => entry.plugin.provides?.includes(sessionStoreToken) === true);
  const hasDshProvider = baseProfile.some((entry) => entry.plugin.provides?.includes(dshCompatServiceToken) === true);
  const providedBaseTokens = new Set(baseProfile.flatMap((entry) => entry.plugin.provides ?? []));
  // Every bridgeable service already present in this Profile must settle first.
  // Leaving these as optional lets the compatibility runtime win the startup
  // race and install an independent DSH Agent/Session authority.
  const requiredWebTokens = (dshCompatPlugin.optional ?? []).filter((token) => providedBaseTokens.has(token));
  const webDshCompatPlugin = requiredWebTokens.length > 0 ? {
    ...dshCompatPlugin,
    requires: [...(dshCompatPlugin.requires ?? []), ...requiredWebTokens],
    optional: (dshCompatPlugin.optional ?? []).filter((token) => !requiredWebTokens.includes(token as never)),
  } : dshCompatPlugin;
  const makeProfile = (hostPlugins: typeof installedHostPlugins, workspaceRegistry?: DshWorkspaceRegistryBridge, includeDsh = options.dshCompatibility !== false): Profile => defineProfile([
        ...baseProfile,
        plugin(eventBridge, undefined),
        ...(!includeDsh || hasDshProvider ? [] : [
        plugin(webDshCompatPlugin, {
          agentPresets: { default: "standard" },
          sessionQuerySqlite: false,
          sessionQuerySearch: false,
          plugins: hostPlugins.map((entry) => ({
            plugin: entry.plugin as DshPluginSource,
            config: entry.config,
            enabled: entry.enabled,
          })),
          // One aggregated compatibility runtime owns this deployment-level
          // route, so third-party plugin generations never register it twice.
          ...(hasAttachmentProvider && hasSessionProvider ? { sessionLogExport: {} } : {}),
          services: { webServer: routes, connection, typertGateway: remoteEvents, ...(workspaceRegistry === undefined ? {} : { workspaceRegistry }) },
        }),
        ]),
      ]);
  const previousDshHome = process.env.DSH_HOME;
  const previousDshProfile = process.env.DSH_PROFILE;
  const environment = manager.dshEnvironment();
  process.env.DSH_HOME = environment.DSH_HOME;
  process.env.DSH_PROFILE = environment.DSH_PROFILE;
  let kernel: Kernel<any>;
  try {
    kernel = await startProfile(makeProfile([], undefined, false), { initialServices: [[webRouteServiceToken, routes]] });
  } catch (error) {
    restoreEnvironment("DSH_HOME", previousDshHome);
    restoreEnvironment("DSH_PROFILE", previousDshProfile);
    throw error;
  }
  const workspaces = kernel.has(sessionStoreToken)
    ? new WorkspaceRegistry(options.workspaceRegistryPath ?? join(options.dataHome ?? join(cwd, ".seal-harness"), "workspaces.json"), kernel.use(sessionStoreToken))
    : undefined;
  await workspaces?.start();
  const dshWorkspaceRegistry = workspaces === undefined ? undefined : new DshWorkspaceRegistryBridge(workspaces);
  await dshWorkspaceRegistry?.start();
  try { await kernel.reconfigure(makeProfile(installedHostPlugins, dshWorkspaceRegistry)); }
  catch (error) { await kernel.stop().catch(() => {}); restoreEnvironment("DSH_HOME", previousDshHome); restoreEnvironment("DSH_PROFILE", previousDshProfile); throw error; }
  const existingUiThemeSettings = kernel.has(settingsServiceToken) ? kernel.use(settingsServiceToken).scope("ui-theme") : undefined;
  const uiThemeSettings = existingUiThemeSettings ?? (kernel.has(settingsServiceToken) ? kernel.use(settingsServiceToken).register("ui-theme", {
    base: { preference: "system", fontSize: 14 }, applies: "live",
    schema: { type: "object", properties: { preference: { type: "string", enum: ["light", "dark", "system"] }, fontSize: { type: "integer", minimum: 12, maximum: 17 } } },
    validate(value) { if (!["light", "dark", "system"].includes(String(value.preference)) || !Number.isInteger(value.fontSize) || Number(value.fontSize) < 12 || Number(value.fontSize) > 17) throw new TypeError("invalid ui-theme settings"); return value; },
  }) : undefined);
  const existingUiConversationSettings = kernel.has(settingsServiceToken) ? kernel.use(settingsServiceToken).scope("ui-conversation") : undefined;
  const uiConversationSettings = existingUiConversationSettings ?? (kernel.has(settingsServiceToken) ? kernel.use(settingsServiceToken).register("ui-conversation", {
    base: { busyEnter: "queue" }, applies: "live",
    schema: { type: "object", properties: { busyEnter: { type: "string", enum: ["queue", "steer"] } } },
    validate(value) { if (!["queue", "steer"].includes(String(value.busyEnter))) throw new TypeError("invalid ui-conversation settings"); return value; },
  }) : undefined);
  const existingUiChatSettings = kernel.has(settingsServiceToken) ? kernel.use(settingsServiceToken).scope("ui-chat") : undefined;
  const uiChatSettings = existingUiChatSettings ?? (kernel.has(settingsServiceToken) ? kernel.use(settingsServiceToken).register("ui-chat", {
    base: { transcriptView: "compact" }, applies: "live",
    schema: { type: "object", properties: { transcriptView: { type: "string", enum: ["normal", "compact"] } } },
    validate(value) { if (!["normal", "compact"].includes(String(value.transcriptView))) throw new TypeError("invalid ui-chat settings"); return value; },
  }) : undefined);
  const reconfigurePlugins = async (): Promise<void> => {
    const environment = manager.dshEnvironment();
    process.env.DSH_HOME = environment.DSH_HOME;
    process.env.DSH_PROFILE = environment.DSH_PROFILE;
    await dshWorkspaceRegistry?.refresh();
    await kernel.reconfigure(makeProfile(await manager.loadHostPlugins(), dshWorkspaceRegistry));
  };
  const runs = new Map<string, AgentExecution>();
  const dshControl = new DshControlHub();
  if (kernel.has(jobServiceToken)) dshControl.trackJobs(kernel.use(jobServiceToken));
  if (kernel.has(sessionStoreToken)) dshControl.trackProjections(webEvents, kernel.use(sessionStoreToken), kernel.has(attachmentServiceToken) ? kernel.use(attachmentServiceToken).imageLimits : undefined);
  const clientPluginState: { report: JsonObject | undefined } = { report: undefined };
  const dispatchContext: DispatchContext = {
    cwd, kernel, runs, workspaces, dshWorkspaceRegistry, authenticator, approvalService, questionAnswerer, credentialEnvironment,
    manager, routes, connection, remoteEvents, clientPluginState, webEvents, dshControl, reconfigurePlugins,
    localPluginManagement: isLoopbackHost(host),
  };
  const remoteMux = new DshRemoteStreamMux((endpoint, payload, signal) => openDshStream(dispatchContext, endpoint, payload, signal));
  const unregisterRemoteMux = routes.registerUpgrade({
    path: "/api/remote.mux",
    handler: (request, socket, head) => remoteMux.handleUpgrade(request, socket, head),
  });
  const server = createServer((request, response) => {
    void dispatch(request, response, dispatchContext).catch((error) => {
      const dsh = dshRemoteFailure(error);
      if (!response.headersSent) json(response, webErrorStatus(error), { error: message(error), ...(error instanceof RequestError && error.payload !== undefined ? error.payload : {}), ...(dsh === undefined ? {} : { code: dsh.code, details: dsh.details }) });
      else if (!response.writableEnded) response.end();
    });
  });
  server.on("upgrade", (request, socket, head) => {
    const rejection = connection.requestRejection(request);
    if (rejection !== undefined) { rejectUpgrade(socket, rejection); return; }
    const pathname = upgradePath(request);
    const route = pathname === undefined ? undefined : routes.getUpgrade(pathname);
    if (route === undefined) { rejectUpgrade(socket, 404); return; }
    try { route.handler(request, socket, head); }
    catch { socket.destroy(); }
  });

  try {
    await listenFetchSafe(server, options.port ?? 3080, host);
  } catch (error) {
    approvalService.close(error);
    questionAnswerer.close(error);
    await kernel.stop();
    restoreEnvironment("DSH_HOME", previousDshHome);
    restoreEnvironment("DSH_PROFILE", previousDshProfile);
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Web server has no TCP address");
  const url = `http://${formatHost(host)}:${address.port}`;
  if (authenticator !== undefined) {
    if (host === "0.0.0.0" || host === "::") authenticator.wildcardPort = address.port;
    else authenticator.authority = new URL(url).host;
  }
  const launchUrl = authenticator === undefined ? url : `${url}/?token=${authenticator.launchToken}`;
  let closed = false;
  return {
    url,
    launchUrl,
    host,
    port: address.port,
    kernel,
    approvalService,
    questionAnswerer,
    async close() {
      if (closed) return;
      closed = true;
      for (const execution of runs.values()) execution.abort(new Error("Web server stopped"));
      approvalService.close();
      questionAnswerer.close();
      webEvents.close();
      dshControl.close();
      remoteEvents.close();
      await disposeRemoteEventResults();
      unregisterRemoteMux();
      await remoteMux.close();
      await closeServer(server);
      if (existingUiChatSettings === undefined) uiChatSettings?.dispose();
      if (existingUiConversationSettings === undefined) uiConversationSettings?.dispose();
      if (existingUiThemeSettings === undefined) uiThemeSettings?.dispose();
      await kernel.stop();
      restoreEnvironment("DSH_HOME", previousDshHome);
      restoreEnvironment("DSH_PROFILE", previousDshProfile);
    },
  };
}

interface DispatchContext {
  readonly cwd: string;
  readonly kernel: Kernel<any>;
  readonly runs: Map<string, AgentExecution>;
  readonly workspaces: WorkspaceRegistry | undefined;
  readonly dshWorkspaceRegistry: DshWorkspaceRegistryBridge | undefined;
  readonly authenticator: WebAuthenticator | undefined;
  readonly approvalService: WebApprovalService;
  readonly questionAnswerer: WebQuestionAnswerer;
  readonly credentialEnvironment: Record<string, string | undefined>;
  readonly manager: PluginProfileManager;
  readonly routes: WebRouteRegistry;
  readonly connection: DshConnectionBridge;
  readonly remoteEvents: DshRemoteEventGateway;
  readonly clientPluginState: { report: JsonObject | undefined };
  readonly webEvents: WebEventStream;
  readonly dshControl: DshControlHub;
  readonly reconfigurePlugins: () => Promise<void>;
  readonly localPluginManagement: boolean;
}

async function openDshStream(context: DispatchContext, endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
  const args = remoteStreamArgs(payload);
  if (endpoint === "$events") {
    if (Object.keys(args).length !== 0) throw new RequestError(400, "$events accepts no arguments", { code: "gateway/arguments-invalid", details: {} });
    return dshEventStream(context, signal);
  }
  if (endpoint === "session/follow") {
    if (!("request" in args)) throw new RequestError(400, "session/follow requires request", { code: "gateway/arguments-invalid", details: {} });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { follow?: (request: unknown, signal: AbortSignal) => AsyncIterable<unknown> } | undefined;
    if (controller?.follow !== undefined) return controller.follow(args.request, signal);
    return dshFollowStream(context, args.request, signal);
  }
  if (endpoint === "session/control") {
    if (Object.keys(args).length !== 0) throw new RequestError(400, "session/control accepts no arguments", { code: "gateway/arguments-invalid", details: {} });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { control?: (signal: AbortSignal) => AsyncIterable<unknown> } | undefined;
    if (controller?.control !== undefined) return controller.control(signal);
    return dshControlStream(context, signal);
  }
  if (endpoint === "workspace/follow") {
    if (Object.keys(args).length !== 0) throw new RequestError(400, "workspace/follow accepts no arguments", { code: "gateway/arguments-invalid", details: {} });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("workspaceController") as { follow?: (signal: AbortSignal) => AsyncIterable<unknown> } | undefined;
    return controller?.follow?.(signal) ?? dshWorkspaceFollowStream(context, signal);
  }
  throw new RequestError(404, `Unknown Remote stream endpoint: ${endpoint}`, { code: "gateway/method-not-found", details: { endpoint } });
}

async function* dshWorkspaceFollowStream(context: DispatchContext, signal: AbortSignal): AsyncGenerator<unknown> {
  if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
  let previous: { items: JsonObject[]; archivedSessionIds: string[] } | undefined;
  while (!signal.aborted) {
    const rows = await context.workspaces.list();
    const current = {
      items: rows.map((row) => ({ workspaceId: row.id, path: row.path, title: row.title, sessionIds: [...row.sessionIds], createdAt: row.createdAt, updatedAt: row.updatedAt })),
      archivedSessionIds: [...context.workspaces.archivedSessionIds()],
    };
    if (previous === undefined) yield { type: "baseline", value: current };
    else {
      const priorById = new Map(previous.items.map((row) => [String(row.workspaceId), row]));
      const nextById = new Map(current.items.map((row) => [String(row.workspaceId), row]));
      for (const row of current.items) if (JSON.stringify(priorById.get(String(row.workspaceId))) !== JSON.stringify(row)) yield { type: "upsert", workspace: row };
      for (const row of previous.items) if (!nextById.has(String(row.workspaceId))) yield { type: "remove", workspaceId: row.workspaceId };
      const priorOrder = previous.items.map((row) => row.workspaceId); const nextOrder = current.items.map((row) => row.workspaceId);
      if (JSON.stringify(priorOrder) !== JSON.stringify(nextOrder)) yield { type: "order", workspaceIds: nextOrder };
      if (JSON.stringify(previous.archivedSessionIds) !== JSON.stringify(current.archivedSessionIds)) yield { type: "archived", archivedSessionIds: current.archivedSessionIds };
    }
    previous = current;
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 250); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
  }
}

async function* dshEventStream(context: DispatchContext, signal: AbortSignal): AsyncGenerator<unknown> {
  if (context.remoteEvents.hasRegistration()) {
    yield* context.remoteEvents.open(signal, homedir());
    return;
  }
  const notifications = new AsyncValueQueue<{ type: string; payload: unknown }>(signal);
  const dispose = context.webEvents.subscribe((type, payload) => notifications.push({ type, payload }));
  try {
    yield { type: "ready", clientId: randomUUID(), host: { home: homedir() } };
    while (!signal.aborted) {
      const frame = await notifications.next();
      yield { type: "emit", event: frame.type, args: [frame.payload] };
    }
  } finally { dispose(); notifications.close(); }
}

function remoteStreamArgs(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || !("args" in payload)) {
    throw new RequestError(400, "Remote stream payload must contain exactly args", { code: "gateway/arguments-invalid", details: {} });
  }
  const args = (payload as { args: unknown }).args;
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new RequestError(400, "Remote stream args must be an object", { code: "gateway/arguments-invalid", details: {} });
  return args as Record<string, unknown>;
}

async function* dshFollowStream(context: DispatchContext, request: unknown, signal: AbortSignal): AsyncGenerator<unknown> {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new RequestError(400, "session follow request must be an object", { code: "gateway/arguments-invalid", details: {} });
  const body = request as JsonObject; const address = body.address;
  if (address === null || typeof address !== "object" || Array.isArray(address)) throw new RequestError(400, "session follow address must be an object", { code: "gateway/arguments-invalid", details: {} });
  const addressRecord = address as JsonObject;
  if (addressRecord.kind !== "session") throw new RequestError(409, "Subagent history requires a durable DSH subagent catalog", { code: "session/agent-busy", details: { reason: "subagent history is unavailable in this Profile" } });
  const id = sessionId(requiredString(addressRecord, "sessionId")); const maxMessages = body.maxMessages;
  if (maxMessages !== undefined && (!Number.isSafeInteger(maxMessages) || (maxMessages as number) <= 0)) throw new RequestError(400, "maxMessages must be a positive safe integer", { code: "gateway/arguments-invalid", details: {} });
  const store = context.kernel.use(sessionStoreToken); const notifications = new AsyncNotification(signal);
  const dispose = context.webEvents.subscribe((type, payload) => {
    if (type === "session.appended" && payload !== null && typeof payload === "object" && (payload as { sessionId?: unknown }).sessionId === id) notifications.push();
  });
  try {
    const session = await store.read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const history = dshWireHistory(session, await dshAttachmentMetadata(context, session)); let cursor = history.records.length - 1;
    const page = dshHistoryPage(history.records, cursor, undefined, maxMessages as number | undefined);
    yield { type: "snapshot", header: history.header, cursor, records: page.records, hasMore: page.hasMore, projections: { asOfSeq: cursor, values: {} } };
    while (!signal.aborted) {
      await notifications.next();
      const current = await store.read(id); if (current === undefined) continue;
      const currentHistory = dshWireHistory(current, await dshAttachmentMetadata(context, current));
      for (const record of currentHistory.records.slice(cursor + 1)) { yield record; cursor = record.event.seq; }
    }
  } finally { dispose(); notifications.close(); }
}

async function* dshControlStream(context: DispatchContext, signal: AbortSignal): AsyncGenerator<unknown> {
  const notifications = new AsyncValueQueue<unknown>(signal); const dispose = context.dshControl.subscribe((frame) => notifications.push(frame));
  try {
    const sessions = await context.kernel.use(sessionStoreToken).list();
    const queues: Record<string, unknown> = {}; const jobs: Record<string, unknown> = {}; const projections: Record<string, unknown> = {};
    const jobService = context.kernel.has(jobServiceToken) ? context.kernel.use(jobServiceToken) : undefined;
    for (const session of sessions) {
      const execution = [...context.runs.values()].find((candidate) => candidate.sessionId === session.id);
      queues[session.id] = dshQueueItems(execution?.pendingMessages?.() ?? context.dshControl.pending(session.id));
      jobs[session.id] = jobService === undefined ? [] : dshJobs(jobService.list(session.id).filter((job) => job.ownerSession === session.id));
      projections[session.id] = dshProjectionBaseline(session, context.kernel.has(attachmentServiceToken) ? context.kernel.use(attachmentServiceToken).imageLimits : undefined);
    }
    yield { type: "baseline", value: { queues, jobs, projections } };
    while (!signal.aborted) yield await notifications.next();
  } finally { dispose(); notifications.close(); }
}

class AsyncValueQueue<T> {
  readonly #values: T[] = []; #wake: (() => void) | undefined; #closed = false;
  constructor(readonly signal: AbortSignal) { signal.addEventListener("abort", () => { this.#closed = true; this.#wake?.(); }, { once: true }); }
  push(value: T): void { if (this.#closed) return; this.#values.push(value); this.#wake?.(); this.#wake = undefined; }
  close(): void { this.#closed = true; this.#wake?.(); this.#wake = undefined; }
  async next(): Promise<T> {
    while (this.#values.length === 0) { if (this.#closed || this.signal.aborted) throw this.signal.reason ?? new Error("stream closed"); await new Promise<void>((resolve) => { this.#wake = resolve; }); }
    return this.#values.shift() as T;
  }
}

class AsyncNotification {
  readonly #queue: AsyncValueQueue<true>; #pending = false;
  constructor(signal: AbortSignal) { this.#queue = new AsyncValueQueue(signal); }
  push(): void { if (this.#pending) return; this.#pending = true; this.#queue.push(true); }
  async next(): Promise<void> { await this.#queue.next(); this.#pending = false; }
  close(): void { this.#queue.close(); }
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  context: DispatchContext,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (context.authenticator !== undefined && !context.authenticator.authorize(request, response, url)) return;
  if (!isSafeOrigin(request)) {
    json(response, 403, { error: "Cross-origin request rejected" });
    return;
  }

  if (await context.connection.intercept(request, response, url.pathname)) return;

  const pluginRoute = context.routes.get(url.pathname);
  if (pluginRoute !== undefined) {
    await pluginRoute.handler(request, response);
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok", cwd: context.cwd, home: homedir() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/models") {
    json(response, 200, await context.kernel.use(modelServiceToken).list());
    return;
  }
  if (method === "GET" && url.pathname === "/api/events") {
    context.webEvents.connect(request, response);
    return;
  }
  if (method === "GET" && url.pathname === "/api/commands") {
    json(response, 200, context.kernel.has(commandServiceToken) ? context.kernel.use(commandServiceToken).list() : []);
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/commands") {
    const rawSessionId = url.searchParams.get("sessionId");
    if (rawSessionId === null || rawSessionId.length === 0) throw new RequestError(400, "sessionId is required");
    const id = sessionId(rawSessionId);
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const commands = runtime?.context.get("commands") as { list?: (agent: unknown) => unknown } | undefined;
    const agents = runtime?.context.get("agents") as { get?: (id: string) => unknown; resume?: (options: { resumeSessionId: string }) => Promise<{ readonly agent: unknown; dispose(): Promise<void> }> } | undefined;
    if (commands?.list !== undefined && agents !== undefined) {
      let temporary: { readonly agent: unknown; dispose(): Promise<void> } | undefined;
      const live = agents.get?.(id);
      if (live === undefined && agents.resume !== undefined) temporary = await agents.resume({ resumeSessionId: id });
      const agent = live ?? temporary?.agent;
      if (agent === undefined) throw new RequestError(404, `Session ${JSON.stringify(id)} was not found`, { code: "session/not-found", details: { sessionId: id } });
      try { json(response, 200, commands.list(agent)); }
      finally { await temporary?.dispose(); }
      return;
    }
    json(response, 200, context.kernel.has(commandServiceToken) ? context.kernel.use(commandServiceToken).list() : []);
    return;
  }
  if (method === "GET" && url.pathname === "/api/agent-presets") {
    if (!context.kernel.has(agentPresetServiceToken)) { json(response, 200, { presets: [], defaultPreset: null }); return; }
    const service = context.kernel.use(agentPresetServiceToken); json(response, 200, { presets: service.list(), defaultPreset: service.defaultPreset }); return;
  }
  const presetSelectMatch = /^\/api\/sessions\/([^/]+)\/agent-preset$/.exec(url.pathname);
  if (method === "PUT" && presetSelectMatch !== null) {
    const id = sessionId(decodeURIComponent(presetSelectMatch[1] ?? ""));
    const preset = requiredString(await readObject(request), "agentPreset");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const dshPresets = runtime?.context.get("agentPresets") as { select?: (agent: unknown, id: string) => Promise<string> } | undefined;
    const dshAgents = runtime?.context.get("agents") as { get?: (id: string) => unknown; resume?: (options: { resumeSessionId: string }) => Promise<{ readonly agent: unknown; dispose(): Promise<void> }> } | undefined;
    if (dshPresets?.select !== undefined && dshAgents !== undefined) {
      let temporary: { readonly agent: unknown; dispose(): Promise<void> } | undefined;
      const live = dshAgents.get?.(id);
      if (live === undefined && dshAgents.resume !== undefined) temporary = await dshAgents.resume({ resumeSessionId: id });
      const agent = live ?? temporary?.agent;
      if (agent === undefined) throw new RequestError(404, `Session ${JSON.stringify(id)} was not found`, { code: "session/not-found", details: { sessionId: id } });
      try { json(response, 200, await dshPresets.select(agent, preset)); }
      finally { await temporary?.dispose(); }
      return;
    }
    if (!context.kernel.has(agentPresetServiceToken)) throw new RequestError(501, "Agent presets are not available in this Profile");
    try { json(response, 200, await context.kernel.use(agentPresetServiceToken).set(id, preset)); }
    catch (error) {
      const diagnostic = message(error);
      if (diagnostic.includes("unknown agent preset")) throw new RequestError(404, diagnostic, { code: "agent-preset/not-found", details: { agentPreset: preset, available: context.kernel.use(agentPresetServiceToken).list().map((entry) => entry.id) } });
      if (diagnostic.includes("already started")) throw new RequestError(409, diagnostic, { code: "agent-preset/locked", details: { sessionId: id, agentPreset: preset } });
      throw error;
    }
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/agent-presets") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const presets = runtime?.context.get("agentPresets") as { remoteExportList?: () => Promise<unknown> } | undefined;
    if (presets?.remoteExportList !== undefined) { json(response, 200, await presets.remoteExportList()); return; }
    if (!context.kernel.has(agentPresetServiceToken)) { json(response, 200, { presets: [], authorable: false }); return; }
    const service = context.kernel.use(agentPresetServiceToken); const defaultPreset = service.defaultPreset;
    json(response, 200, { presets: service.list().map(({ name, ...preset }) => ({ ...preset, trust: "system", isDefault: preset.id === defaultPreset, ...(name === preset.id ? {} : { name }) })), authorable: false });
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/agent-presets") {
    const body = await readObject(request); const operation = requiredString(body, "operation");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const presets = runtime?.context.get("agentPresets") as {
      readDocument?: (id: string) => Promise<unknown>;
      remoteExportCopy?: (from: string, id: string, name?: string) => Promise<void>;
      remoteExportDelete?: (id: string) => Promise<void>;
    } | undefined;
    if (presets === undefined) throw new RequestError(409, "Seal presets are Profile-owned", { code: "agent-preset/read-only", details: { agentPreset: typeof body.agentPreset === "string" ? body.agentPreset : typeof body.id === "string" ? body.id : "", reason: "Profile-owned presets have no authored Cordis composition" } });
    if (operation === "read" && presets.readDocument !== undefined) { json(response, 200, await presets.readDocument(requiredString(body, "agentPreset"))); return; }
    if (operation === "copy" && presets.remoteExportCopy !== undefined) { await presets.remoteExportCopy(requiredString(body, "from"), requiredString(body, "id"), optionalString(body, "name")); json(response, 200, null); return; }
    if (operation === "delete" && presets.remoteExportDelete !== undefined) { await presets.remoteExportDelete(requiredString(body, "id")); json(response, 200, null); return; }
    throw new RequestError(400, "Unknown Agent Preset operation");
  }
  if (method === "GET" && url.pathname === "/api/settings") {
    if (!context.kernel.has(settingsServiceToken)) { json(response, 200, { writable: false, namespaces: [] }); return; }
    const service = context.kernel.use(settingsServiceToken);
    json(response, 200, { writable: service.writable, hasDocument: service.documentPath !== undefined, namespaces: service.describe({ redactSecrets: true }) });
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/settings/capabilities") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("settingsController") as { canOpenAgentPresetDirectory?: () => boolean } | undefined;
    json(response, 200, { canOpenAgentPresetDirectory: controller?.canOpenAgentPresetDirectory?.() ?? canOpenNativePath() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/settings/describe") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("settingsController") as { describe?: () => unknown } | undefined;
    if (controller?.describe !== undefined) { json(response, 200, controller.describe()); return; }
    if (!context.kernel.has(settingsServiceToken)) { json(response, 200, { writable: false, hasDocument: false, namespaces: [] }); return; }
    const service = context.kernel.use(settingsServiceToken);
    json(response, 200, { writable: service.writable, hasDocument: service.documentPath !== undefined, namespaces: service.describe({ redactSecrets: true }) });
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/session/capabilities") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { canOpenWorkspacePath?: () => boolean } | undefined;
    json(response, 200, { canOpenWorkspacePath: controller?.canOpenWorkspacePath?.() ?? canOpenNativePath() });
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/read") {
    const body = await readObject(request);
    const operation = requiredString(body, "operation");
    if (operation !== "list" && operation !== "search" && operation !== "modelCatalog" && operation !== "attachment") throw new RequestError(400, `Unknown read-only session operation: ${operation}`);
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as {
      list?: (request: JsonObject, signal: AbortSignal) => Promise<unknown>;
      search?: (request: JsonObject, signal: AbortSignal) => Promise<unknown>;
      modelCatalog?: () => Promise<unknown>;
      attachment?: (request: JsonObject) => Promise<unknown>;
    } | undefined;
    const invoke = controller?.[operation];
    if (invoke === undefined) { json(response, 200, { available: false }); return; }
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    const value = operation === "list"
      ? await controller!.list!({}, abort.signal)
      : operation === "search"
        ? await controller!.search!((body.request ?? {}) as JsonObject, abort.signal)
        : operation === "attachment"
          ? await controller!.attachment!((body.request ?? {}) as JsonObject)
        : await controller!.modelCatalog!();
    json(response, 200, { available: true, value });
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/write") {
    const body = await readObject(request);
    const operation = requiredString(body, "operation");
    if (!["create", "selectModel", "rename", "fork", "prompt", "cancel", "updateQueue"].includes(operation)) throw new RequestError(400, `Unknown session operation: ${operation}`);
    const requestBody = body.request;
    if (requestBody === null || typeof requestBody !== "object" || Array.isArray(requestBody)) throw new RequestError(400, "session operation request must be an object");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as Record<string, ((request: JsonObject, signal?: AbortSignal) => unknown) | undefined> | undefined;
    const invoke = controller?.[operation];
    if (invoke === undefined) { json(response, 200, { available: false }); return; }
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    json(response, 200, { available: true, value: await invoke.call(controller, requestBody as JsonObject, abort.signal) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/open-workspace-path") {
    const body = await readObject(request);
    const path = requiredString(body, "path");
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { openWorkspacePath?: (request: { path: string }, signal: AbortSignal) => Promise<unknown> } | undefined;
    if (controller?.openWorkspacePath !== undefined) {
      json(response, 200, await controller.openWorkspacePath({ path }, abort.signal));
    } else {
      await openNativePath(path, abort.signal);
      json(response, 200, { opened: true });
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/settings/open-document") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("settingsController") as { openSettingsDocument?: (signal: AbortSignal) => Promise<unknown> } | undefined;
    if (controller?.openSettingsDocument !== undefined) {
      const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
      json(response, 200, await controller.openSettingsDocument(abort.signal)); return;
    }
    if (!context.kernel.has(settingsServiceToken)) throw new RequestError(501, "Settings are not available in this Profile");
    const settings = context.kernel.use(settingsServiceToken);
    const path = await settings.prepareDocument?.() ?? settings.documentPath;
    if (path === undefined) throw new RequestError(409, "Settings provider has no local document to open");
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    await openNativeTextFile(path, abort.signal);
    json(response, 200, { opened: true });
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/settings/open-agent-preset-directory") {
    const agentPreset = requiredString(await readObject(request), "agentPreset");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("settingsController") as { openAgentPresetDirectory?: (id: string, signal: AbortSignal) => Promise<unknown> } | undefined;
    if (controller?.openAgentPresetDirectory !== undefined) {
      const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
      json(response, 200, await controller.openAgentPresetDirectory(agentPreset, abort.signal)); return;
    }
    const presets = runtime?.context.get("agentPresets") as { resolve?: (id: string) => Promise<{ readonly id: string; readonly trust: "system" | "user"; readonly path: string }> } | undefined;
    if (presets?.resolve === undefined) throw new RequestError(404, "This deployment composes no DSH Agent Presets", { code: "agent-preset/not-found", details: { agentPreset, available: [] } });
    const preset = await presets.resolve(agentPreset);
    if (preset.trust !== "user") throw new RequestError(409, `Agent preset ${JSON.stringify(preset.id)} ships with the deployment`, { code: "agent-preset/read-only", details: { agentPreset: preset.id, reason: "it ships with the deployment" } });
    const path = dirname(preset.path);
    if (!canOpenNativePath()) { json(response, 200, { opened: false, path }); return; }
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    await openNativePath(path, abort.signal);
    json(response, 200, { opened: true });
    return;
  }
  const dshSettingsMatch = /^\/api\/dsh\/settings\/([^/]+)$/.exec(url.pathname);
  if (method === "PUT" && dshSettingsMatch !== null) {
    const namespace = decodeURIComponent(dshSettingsMatch[1] ?? "");
    const body = await readObject(request); const mode = body.mode; const expectedRevision = body.expectedRevision;
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("settingsController") as { update?: (ns: string, value: JsonObject, revision: number | undefined) => Promise<unknown>; replace?: (ns: string, value: JsonObject, revision: number | undefined) => Promise<unknown>; mutate?: (ns: string, ops: unknown[], revision: number | undefined) => Promise<unknown> } | undefined;
    if (controller !== undefined) {
      if (mode === "mutate") { if (!Array.isArray(body.ops) || controller.mutate === undefined) throw new RequestError(400, "ops must be an array"); json(response, 200, await controller.mutate(namespace, body.ops, expectedRevision as number | undefined)); return; }
      if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) throw new RequestError(400, "value must be a JSON object");
      if (mode === "replace" && controller.replace !== undefined) { json(response, 200, await controller.replace(namespace, body.value as JsonObject, expectedRevision as number | undefined)); return; }
      if ((mode === undefined || mode === "update") && controller.update !== undefined) { json(response, 200, await controller.update(namespace, body.value as JsonObject, expectedRevision as number | undefined)); return; }
      throw new RequestError(400, "mode must be update, replace, or mutate");
    }
    if (!context.kernel.has(settingsServiceToken)) throw new RequestError(501, "Settings are not available in this Profile");
    const scope = context.kernel.use(settingsServiceToken).scope(namespace);
    if (scope === undefined) throw new RequestError(404, "Settings namespace not found");
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0)) throw new RequestError(400, "expectedRevision must be a non-negative integer");
    let result;
    if (mode === "mutate") {
      if (!Array.isArray(body.ops)) throw new RequestError(400, "ops must be an array");
      result = await scope.mutate(body.ops as never, expectedRevision as number | undefined);
    } else {
      if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) throw new RequestError(400, "value must be a JSON object");
      result = mode === "replace" ? await scope.replace(body.value as JsonObject, expectedRevision as number | undefined) : mode === undefined || mode === "update" ? await scope.update(body.value as JsonObject, expectedRevision as number | undefined) : (() => { throw new RequestError(400, "mode must be update, replace, or mutate"); })();
    }
    const redacted = context.kernel.use(settingsServiceToken).describe({ redactSecrets: true }).find((entry) => entry.namespace === result.namespace);
    json(response, 200, redacted ?? result);
    return;
  }
  const settingsMatch = /^\/api\/settings\/([^/]+)$/.exec(url.pathname);
  if (method === "PUT" && settingsMatch !== null) {
    if (!context.kernel.has(settingsServiceToken)) throw new RequestError(501, "Settings are not available in this Profile");
    const namespace = decodeURIComponent(settingsMatch[1] ?? "");
    const scope = context.kernel.use(settingsServiceToken).scope(namespace);
    if (scope === undefined) throw new RequestError(404, "Settings namespace not found");
    const body = await readObject(request); const value = body.value;
    const revision = body.expectedRevision;
    if (revision !== undefined && (!Number.isSafeInteger(revision) || (revision as number) < 0)) throw new RequestError(400, "expectedRevision must be a non-negative integer");
    try {
      let result;
      if (body.mode === "mutate") {
        if (!Array.isArray(body.ops)) throw new RequestError(400, "ops must be an array");
        result = await scope.mutate(body.ops as never, revision as number | undefined);
      } else {
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RequestError(400, "value must be a JSON object");
        result = body.mode === "replace" ? await scope.replace(value as JsonObject, revision as number | undefined) : body.mode === undefined || body.mode === "update" ? await scope.update(value as JsonObject, revision as number | undefined) : (() => { throw new RequestError(400, "mode must be update, replace, or mutate"); })();
      }
      const redacted = context.kernel.use(settingsServiceToken).describe({ redactSecrets: true }).find((entry) => entry.namespace === result.namespace);
      json(response, 200, redacted ?? result);
    } catch (error) {
      if (error instanceof SettingsConflictError) { json(response, 409, { error: error.message, code: error.code, expected: error.expected, actual: error.actual }); return; }
      throw error;
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/providers/discover") {
    const service = context.kernel.use(modelServiceToken);
    if (!(service instanceof PiAiModelService)) {
      throw new RequestError(409, "The active model service does not support custom providers");
    }
    const body = await readObject(request);
    const id = requiredString(body, "id");
    const baseUrl = requiredString(body, "baseUrl");
    const name = optionalString(body, "name");
    const api = optionalProviderApi(body.api);
    const apiKey = optionalString(body, "apiKey");
    let models;
    try {
      models = await service.discoverAndAdd({
        id,
        baseUrl,
        ...(name === undefined ? {} : { name }),
        ...(api === undefined ? {} : { api }),
      }, {
        ...(apiKey === undefined ? {} : { apiKey }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new RequestError(502, message(error));
    }
    if (apiKey !== undefined) context.credentialEnvironment[credentialVariable(id)] = apiKey;
    await context.kernel.emit("models.updated", {
      revision: service.catalogRevision,
      providers: [...new Set((await service.list()).map((model) => model.provider))],
    });
    json(response, 201, { provider: id, models });
    return;
  }
  if (method === "GET" && url.pathname === "/api/plugins/client-batch") {
    const entries = (await context.manager.list()).filter((entry) => entry.clientEntry !== undefined); const revision = clientBatchRevision(entries);
    if (url.searchParams.get("rev") !== revision) { json(response, 409, { error: "Client plugin batch revision is stale", code: "CLIENT_PLUGIN_BATCH_STALE", revision }); return; }
    const sources = await Promise.all(entries.map(async (entry) => `${await readFile(entry.clientEntry!, "utf8")}\n//# sourceURL=seal-dsh-client:${encodeURIComponent(entry.name)}\n`));
    await sendCompressible(request, response, Buffer.from(sources.join("\n")), { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, max-age=31536000, immutable" }, true); return;
  }
  if (method === "GET" && url.pathname === "/api/plugins/client") {
    const installed = (await context.manager.list()).filter((entry) => entry.clientEntry !== undefined); const batchUrl = `/api/plugins/client-batch?rev=${encodeURIComponent(clientBatchRevision(installed))}`;
    json(response, 200, installed.map((entry) => ({
        name: entry.name,
        version: entry.version,
        url: `/plugins/${encodeURIComponent(entry.name)}/client.js`,
        initialUrl: batchUrl,
        dependencies: entry.clientInject,
        external: entry.clientExternal,
        immediately: entry.clientImmediately,
        services: [],
        enabled: entry.enabled,
        ...(entry.skin === undefined ? {} : { skin: entry.skin }),
      })));
    return;
  }
  if (method === "GET" && url.pathname === "/api/plugins") {
    const dshRuntime = context.kernel.has(dshCompatServiceToken)
      ? context.kernel.use(dshCompatServiceToken)
      : undefined;
    const entries = await context.manager.doctor({
      hostServiceAvailable: (service) => dshRuntime?.context.get(service) !== undefined,
    });
    json(response, 200, entries.map((entry) => ({
      name: entry.name,
      version: entry.version,
      spec: entry.spec,
      enabled: entry.enabled,
      status: entry.status,
      hostInject: entry.hostInject,
      clientInject: entry.clientInject,
      clientExternal: entry.clientExternal,
      clientImmediately: entry.clientImmediately,
      missingHostServices: entry.missingHostServices,
      missingClientServices: entry.missingClientServices,
      ...(entry.skin === undefined ? {} : { skin: entry.skin }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    })));
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/capabilities") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    json(response, 200, { dynamicCordisRunner: runtime?.context.get("dynamicCordisRunner") !== undefined });
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/plugin-inventory") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const official = runtime?.context.get("pluginInventory") as { list?: () => Promise<unknown> } | undefined;
    if (official?.list !== undefined) { json(response, 200, await official.list()); return; }
    const installed = await context.manager.doctor({
      hostServiceAvailable: (service) => runtime?.context.get(service) !== undefined,
    });
    const entries: Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: "pending" | "loading" | "active" | "failed" | "unloading" | null }> = installed.map((entry) => ({
      entryId: entry.name,
      moduleName: entry.name,
      enabled: entry.enabled,
      fiberPhase: !entry.enabled ? null : entry.status === "ready" ? "active" : entry.status === "invalid" ? "failed" : "pending",
    }));
    const phases = ["pending", "loading", "active", "failed", null, "unloading"] as const;
    const loader = runtime?.context.get("loader") as { entries?: () => Iterable<{ readonly id: string; readonly disabled: boolean; readonly options: { readonly name: string; readonly group?: boolean }; readonly fiber?: { readonly state: number } }> } | undefined;
    for (const entry of loader?.entries?.() ?? []) {
      if (entry.options.group) continue;
      const projected = {
        entryId: entry.id,
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : phases[entry.fiber.state] ?? null,
      } as const;
      const index = entries.findIndex((existing) => existing.entryId === projected.entryId && existing.moduleName === projected.moduleName);
      if (index < 0) entries.push(projected);
      else entries[index] = projected;
    }
    const presets = runtime?.context.get("agentPresets") as { compositionInventory?: () => Promise<readonly { readonly rows: readonly ({ readonly fiberState?: number } & Record<string, unknown>)[] }[]> } | undefined;
    if (presets?.compositionInventory === undefined) { json(response, 200, { entries }); return; }
    const agentPresets = (await presets.compositionInventory()).map((preset) => ({
      ...preset,
      rows: preset.rows.map(({ fiberState, ...row }) => ({
        ...row,
        fiberPhase: fiberState === undefined ? null : phases[fiberState] ?? null,
      })),
    }));
    json(response, 200, { entries, agentPresets });
    return;
  }
  if ((method === "GET" || method === "POST") && url.pathname === "/api/dsh/skins") {
    const skins = (await context.manager.list()).filter((entry) => entry.enabled && entry.clientEntry !== undefined && entry.skin !== undefined).map((entry) => entry.skin!).sort((a, b) => a.order - b.order);
    const settings = context.kernel.has(settingsServiceToken) ? context.kernel.use(settingsServiceToken) : undefined;
    const scope = settings?.scope("seal-skin") ?? settings?.register("seal-skin", { base: { target: "official" }, applies: "live" });
    if (method === "POST") {
      const body = await readObject(request);
      if (body.target !== "official" && !skins.some((skin) => skin.id === body.target)) throw new RequestError(400, "Unknown or disabled skin");
      if (!scope) throw new RequestError(501, "Skin settings are unavailable");
      await scope.update({ target: String(body.target) });
    }
    json(response, 200, { skins, target: scope?.get().value.target ?? "official" });
    return;
  }
  if (method === "POST" && url.pathname === "/api/plugins") {
    requireLocalPluginManagement(context);
    const body = await readObject(request);
    if (body.action !== "add" || typeof body.spec !== "string" || body.spec.trim().length === 0) {
      throw new RequestError(400, "plugin add requires action=add and a non-empty spec");
    }
    const added = await context.manager.add(body.spec);
    await context.reconfigurePlugins();
    json(response, 201, {
      added: added.map((entry) => ({ name: entry.name, version: entry.version })),
      restartRequired: false,
    });
    return;
  }
  const pluginEnabledMatch = /^\/api\/plugins\/([^/]+)\/enabled$/.exec(url.pathname);
  if (method === "POST" && pluginEnabledMatch !== null) {
    requireLocalPluginManagement(context);
    const body = await readObject(request);
    if (typeof body.enabled !== "boolean") throw new RequestError(400, "enabled must be a boolean");
    const name = decodeURIComponent(pluginEnabledMatch[1] ?? "");
    const previous = (await context.manager.list()).find((entry) => entry.name === name)?.enabled;
    if (previous === undefined) throw new RequestError(404, `Plugin is not installed: ${name}`);
    try {
      await context.manager.setEnabled(name, body.enabled);
    }
    catch (error) { throw new RequestError(404, message(error)); }
    try { await context.reconfigurePlugins(); }
    catch (error) {
      try { await context.manager.setEnabled(name, previous); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], `Plugin ${name} activation and configuration rollback failed`); }
      throw new RequestError(500, `Plugin ${name} could not be ${body.enabled ? "enabled" : "disabled"}: ${message(error)}`);
    }
    json(response, 200, { name, enabled: body.enabled, restartRequired: false });
    return;
  }
  const pluginRemoveMatch = /^\/api\/plugins\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && pluginRemoveMatch !== null) {
    requireLocalPluginManagement(context);
    const name = decodeURIComponent(pluginRemoveMatch[1] ?? "");
    try { await context.manager.remove([name]); await context.reconfigurePlugins(); }
    catch (error) { throw new RequestError(404, message(error)); }
    json(response, 200, { removed: name, restartRequired: false });
    return;
  }
  if (method === "GET" && url.pathname === "/api/plugins/client-state") {
    json(response, 200, context.clientPluginState.report ?? { results: [], active: [] });
    return;
  }
  if (method === "POST" && url.pathname === "/api/plugins/client-state") {
    context.clientPluginState.report = await readObject(request);
    json(response, 200, { recorded: true });
    return;
  }
  const attachmentMatch = /^\/api\/attachments\/(sha256%3A[a-f0-9]{64}|sha256:[a-f0-9]{64})$/i.exec(url.pathname);
  if (method === "GET" && attachmentMatch !== null) {
    if (!context.kernel.has(attachmentServiceToken)) throw new RequestError(501, "Attachments are not available in this Profile");
    const id = decodeURIComponent(attachmentMatch[1] ?? "");
    const name = optionalQueryString(url, "name"); const mimeType = optionalQueryString(url, "mimeType");
    const reference: AttachmentBlock = { type: "attachment", id, ...(name === undefined ? {} : { name }), ...(mimeType === undefined ? {} : { mimeType }) };
    const attachment = await context.kernel.use(attachmentServiceToken).get(reference);
    if (attachment === undefined) throw new RequestError(404, "Attachment not found");
    const inline = /^(?:image\/(?:png|jpeg|gif|webp)|application\/pdf)$/i.test(attachment.mimeType);
    response.writeHead(200, securityHeaders({
      "content-type": attachment.mimeType,
      "content-length": String(attachment.data.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name ?? name ?? id.replace(":", "-"))}`,
      "cache-control": "private, max-age=31536000, immutable",
    }));
    response.end(attachment.data); return;
  }
  if (method === "POST" && url.pathname === "/api/attachments") {
    if (!context.kernel.has(attachmentServiceToken)) throw new RequestError(501, "Attachments are not available in this Profile");
    const body = await readObject(request, 29 * 1024 * 1024);
    const name = requiredString(body, "name"); const mimeType = requiredString(body, "mimeType"); const encoded = requiredString(body, "data");
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) throw new RequestError(400, "mimeType is invalid");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new RequestError(400, "data must be canonical base64");
    const data = Buffer.from(encoded, "base64");
    const maxBytes = context.kernel.use(attachmentServiceToken).imageLimits?.maxImageBytes ?? 20 * 1024 * 1024;
    if (data.byteLength > maxBytes) throw new RequestError(413, `Attachment exceeds ${String(maxBytes)} bytes`);
    if (mimeType.startsWith("image/")) await validateUploadedImage(data, mimeType, context.kernel.use(attachmentServiceToken).imageLimits);
    json(response, 201, await context.kernel.use(attachmentServiceToken).put({ name, mimeType, data })); return;
  }
  if (method === "GET" && url.pathname === "/api/workspaces") {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    json(response, 200, await context.workspaces.list());
    return;
  }
  if (method === "POST" && url.pathname === "/api/workspaces") {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    const body = await readObject(request);
    let workspace;
    try { workspace = await context.workspaces.create(requiredString(body, "path"), optionalString(body, "title")); }
    catch (error) { throw new RequestError(400, message(error)); }
    await context.dshWorkspaceRegistry?.refresh();
    json(response, 201, workspace);
    return;
  }
  if (method === "PUT" && url.pathname === "/api/workspaces/order") {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    const body = await readObject(request);
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) throw new RequestError(400, "ids must be an array of strings");
    try { await context.workspaces.reorder(body.ids as string[]); }
    catch (error) { throw new RequestError(400, message(error)); }
    await context.dshWorkspaceRegistry?.refresh();
    json(response, 200, { reordered: true });
    return;
  }
  const workspaceSessionOrderMatch = /^\/api\/workspaces\/([^/]+)\/sessions\/order$/.exec(url.pathname);
  if (workspaceSessionOrderMatch !== null && method === "PUT") {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    const body = await readObject(request);
    try { await context.workspaces.insertSessionBefore(decodeURIComponent(workspaceSessionOrderMatch[1] ?? ""), sessionId(requiredString(body, "sessionId")), optionalString(body, "beforeSessionId") === undefined ? undefined : sessionId(optionalString(body, "beforeSessionId")!)); }
    catch (error) { if (error instanceof WorkspaceNotFoundError) throw new RequestError(404, error.message); throw new RequestError(400, message(error)); }
    await context.dshWorkspaceRegistry?.refresh();
    json(response, 200, { reordered: true }); return;
  }
  const workspaceMatch = /^\/api\/workspaces\/([^/]+)$/.exec(url.pathname);
  if (workspaceMatch !== null && (method === "PUT" || method === "DELETE")) {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    const id = decodeURIComponent(workspaceMatch[1] ?? "");
    if (method === "DELETE") {
      if (!await context.workspaces.remove(id)) throw new RequestError(404, "Workspace not found");
      await context.dshWorkspaceRegistry?.refresh();
      json(response, 200, { removed: true });
    } else {
      const body = await readObject(request);
      try {
        const workspace = await context.workspaces.rename(id, requiredString(body, "title"));
        await context.dshWorkspaceRegistry?.refresh();
        json(response, 200, workspace);
      }
      catch (error) { if (error instanceof WorkspaceNotFoundError) throw new RequestError(404, error.message); throw error; }
    }
    return;
  }
  if (method === "GET" && url.pathname === "/api/sessions") {
    const sessions = await context.kernel.use(sessionStoreToken).list();
    const archived = new Set(context.workspaces?.archivedSessionIds() ?? []);
    const running = new Set([...context.runs.values()].map((execution) => execution.sessionId));
    json(response, 200, sessions.filter((session) => !archived.has(session.id)).map((session) => sessionSummary(session, running.has(session.id))).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))));
    return;
  }
  if (method === "GET" && url.pathname === "/api/sessions/search") {
    const query = (url.searchParams.get("query") ?? "").trim();
    if (query.length === 0 || query.length > 500 || query.includes("\0")) throw new RequestError(400, "session search query must be non-empty, contain at most 500 characters, and contain no NUL");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { search?: (request: { query: string }, signal: AbortSignal) => Promise<unknown> } | undefined;
    if (controller?.search === undefined) { json(response, 200, { items: [], hasMore: false }); return; }
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    try { json(response, 200, await controller.search({ query }, abort.signal)); }
    catch (error) {
      if (isSessionSearchDisabled(error)) json(response, 200, { items: [], hasMore: false });
      else throw error;
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/page") {
    const body = await readObject(request);
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { page?: (request: JsonObject, signal: AbortSignal) => Promise<unknown> } | undefined;
    if (controller?.page !== undefined) {
      const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
      json(response, 200, await controller.page(body, abort.signal)); return;
    }
    const address = body.address;
    if (address === null || typeof address !== "object" || Array.isArray(address)) throw new RequestError(400, "session page address must be an object");
    const addressRecord = address as JsonObject;
    if (addressRecord.kind !== "session") throw new RequestError(409, "Subagent history requires a durable DSH subagent catalog", { code: "session/agent-busy", details: { reason: "subagent history is unavailable in this Profile" } });
    const id = sessionId(requiredString(addressRecord, "sessionId"));
    const throughSeq = body.throughSeq;
    if (!Number.isSafeInteger(throughSeq) || (throughSeq as number) < -1 || Object.is(throughSeq, -0)) throw new RequestError(400, "throughSeq must be an integer greater than or equal to -1");
    const beforeSeq = body.beforeSeq;
    if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || (beforeSeq as number) < 0 || Object.is(beforeSeq, -0))) throw new RequestError(400, "beforeSeq must be a non-negative safe integer");
    const maxMessages = body.maxMessages;
    if (maxMessages !== undefined && (!Number.isSafeInteger(maxMessages) || (maxMessages as number) <= 0)) throw new RequestError(400, "maxMessages must be a positive safe integer");
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const history = dshWireHistory(session, await dshAttachmentMetadata(context, session)); const cursor = history.records.length - 1;
    if ((throughSeq as number) > cursor) throw new RequestError(400, `session page through seq ${String(throughSeq)} is past cursor ${String(cursor)}`);
    json(response, 200, dshHistoryPage(history.records, throughSeq as number, beforeSeq as number | undefined, maxMessages as number | undefined)); return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/follow") {
    const body = await readObject(request);
    const address = body.address;
    if (address === null || typeof address !== "object" || Array.isArray(address)) throw new RequestError(400, "session follow address must be an object");
    const addressRecord = address as JsonObject;
    if (addressRecord.kind !== "session") throw new RequestError(409, "Subagent history requires a durable DSH subagent catalog", { code: "session/agent-busy", details: { reason: "subagent history is unavailable in this Profile" } });
    const id = sessionId(requiredString(addressRecord, "sessionId"));
    const maxMessages = body.maxMessages;
    if (maxMessages !== undefined && (!Number.isSafeInteger(maxMessages) || (maxMessages as number) <= 0)) throw new RequestError(400, "maxMessages must be a positive safe integer");
    const store = context.kernel.use(sessionStoreToken);
    let closed = false; let opened = false; let cursor = -1; let pending = false; let publishing = Promise.resolve();
    const write = (value: unknown): void => { if (!closed && !response.writableEnded) response.write(`${JSON.stringify(value)}\n`); };
    const publishSuffix = async (): Promise<void> => {
      if (closed) return;
      const current = await store.read(id);
      if (current === undefined) return;
      const currentHistory = dshWireHistory(current, await dshAttachmentMetadata(context, current));
      for (const record of currentHistory.records.slice(cursor + 1)) { write(record); cursor = record.event.seq; }
    };
    const dispose = context.webEvents.subscribe((type, payload) => {
      if (type !== "session.appended" || payload === null || typeof payload !== "object" || (payload as { sessionId?: unknown }).sessionId !== id) return;
      pending = true;
      if (!opened) return;
      publishing = publishing.then(async () => { if (!pending) return; pending = false; await publishSuffix(); }).catch(() => { if (!response.writableEnded) response.end(); });
    });
    try {
      const session = await store.read(id);
      if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
      const history = dshWireHistory(session, await dshAttachmentMetadata(context, session)); cursor = history.records.length - 1;
      const page = dshHistoryPage(history.records, cursor, undefined, maxMessages as number | undefined);
      response.writeHead(200, { "cache-control": "no-cache, no-transform", "content-type": "application/x-ndjson; charset=utf-8", connection: "keep-alive", "x-accel-buffering": "no" });
      write({ type: "snapshot", header: history.header, cursor, records: page.records, hasMore: page.hasMore, projections: { asOfSeq: cursor, values: {} } });
      opened = true;
      if (pending) { pending = false; await publishSuffix(); }
      await new Promise<void>((resolveClose) => request.once("close", () => { closed = true; resolveClose(); }));
    } finally {
      closed = true; dispose(); await publishing;
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/control") {
    let closed = false; let opened = false; const buffered: unknown[] = [];
    const write = (value: unknown): void => { if (!closed && !response.writableEnded) response.write(`${JSON.stringify(value)}\n`); };
    const dispose = context.dshControl.subscribe((frame) => { if (opened) write(frame); else buffered.push(frame); });
    try {
      const sessions = await context.kernel.use(sessionStoreToken).list();
      const queues: Record<string, unknown> = {}; const jobs: Record<string, unknown> = {}; const projections: Record<string, unknown> = {};
      const jobService = context.kernel.has(jobServiceToken) ? context.kernel.use(jobServiceToken) : undefined;
      for (const session of sessions) {
        const execution = [...context.runs.values()].find((candidate) => candidate.sessionId === session.id);
        queues[session.id] = dshQueueItems(execution?.pendingMessages?.() ?? context.dshControl.pending(session.id));
        jobs[session.id] = jobService === undefined ? [] : dshJobs(jobService.list(session.id).filter((job) => job.ownerSession === session.id));
        projections[session.id] = dshProjectionBaseline(session, context.kernel.has(attachmentServiceToken) ? context.kernel.use(attachmentServiceToken).imageLimits : undefined);
      }
      response.writeHead(200, { "cache-control": "no-cache, no-transform", "content-type": "application/x-ndjson; charset=utf-8", connection: "keep-alive", "x-accel-buffering": "no" });
      write({ type: "baseline", value: { queues, jobs, projections } }); opened = true;
      for (const frame of buffered.splice(0)) write(frame);
      await new Promise<void>((resolveClose) => request.once("close", () => { closed = true; resolveClose(); }));
    } finally { closed = true; dispose(); }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session/update-queue") {
    const body = await readObject(request); const id = sessionId(requiredString(body, "sessionId")); const itemId = messageId(requiredString(body, "itemId"));
    const action = body.action;
    if (action === null || typeof action !== "object" || Array.isArray(action)) throw new RequestError(400, "queue action must be an object");
    const actionRecord = action as JsonObject; const kind = requiredString(actionRecord, "kind");
    let update: import("@seal-harness/core").PendingMessageAction;
    if (kind === "edit") {
      if (!Array.isArray(actionRecord.content) || actionRecord.content.some((block) => block === null || typeof block !== "object" || Array.isArray(block) || (block as JsonObject).type !== "text" || typeof (block as JsonObject).text !== "string")) throw new RequestError(400, "queue edits accept text content only", { code: "session/attachment-invalid", details: { reason: "QUEUE_EDIT_NON_TEXT" } });
      update = { kind: "edit", content: actionRecord.content.map((block) => text((block as JsonObject).text as string)) };
    } else if (kind === "remove" || kind === "steer") update = { kind };
    else throw new RequestError(400, "queue action kind must be edit, remove, or steer");
    const execution = [...context.runs.values()].find((candidate) => candidate.sessionId === id);
    const result = execution?.updatePendingMessage?.(itemId, update) ?? context.dshControl.updateParked(id, itemId, update);
    if (result === "not-found") throw new RequestError(404, "queued item is no longer pending", { code: "session/queue-item-not-found", details: { itemId } });
    if (result === "steer-unavailable") throw new RequestError(409, "current turn no longer accepts steering", { code: "session/steer-unavailable", details: { itemId } });
    json(response, 200, { accepted: true }); return;
  }
  const sessionQueueMatch = /^\/api\/sessions\/([^/]+)\/queue$/.exec(url.pathname);
  if (method === "GET" && sessionQueueMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionQueueMatch[1] ?? ""));
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const execution = [...context.runs.values()].find((candidate) => candidate.sessionId === id);
    json(response, 200, dshQueueItems(execution?.pendingMessages?.() ?? context.dshControl.pending(id))); return;
  }
  if (method === "POST" && url.pathname === "/api/sessions") {
    const body = await readObject(request);
    if (body.cwd !== undefined && body.workspaceId !== undefined) throw new RequestError(400, "session create accepts workspaceId or cwd, not both");
    let cwd = optionalString(body, "cwd");
    if (body.workspaceId !== undefined) {
      if (context.workspaces === undefined) throw new RequestError(404, "Workspace registry is not available", { code: "workspace/not-found", details: { workspaceId: body.workspaceId } });
      const workspaceId = requiredString(body, "workspaceId");
      const workspace = (await context.workspaces.list()).find((entry) => entry.id === workspaceId);
      if (workspace === undefined) throw new RequestError(404, `Workspace "${workspaceId}" not found`, { code: "workspace/not-found", details: { workspaceId } });
      cwd = workspace.path;
    }
    cwd ??= context.cwd; await assertDirectory(cwd);
    const requestedId = optionalString(body, "sessionId"); const id = sessionId(requestedId ?? `session-${randomUUID()}`);
    const store = context.kernel.use(sessionStoreToken); const existing = await store.read(id);
    if (existing !== undefined) {
      const existingCwd = sessionCwd(existing);
      if (resolve(existingCwd ?? "") !== resolve(cwd)) throw new RequestError(409, `Session "${id}" already uses a different working directory`, { code: "session/conflict", details: { sessionId: id, requestedCwd: cwd, ...(existingCwd === undefined ? {} : { existingCwd }) } });
      const currentPreset = context.kernel.has(agentPresetServiceToken) ? await context.kernel.use(agentPresetServiceToken).current(id) : undefined;
      json(response, 200, { sessionId: id, ...(currentPreset === undefined ? {} : { agentPreset: currentPreset }) }); return;
    }
    const requestedPreset = optionalString(body, "agentPreset");
    if (requestedPreset !== undefined && context.kernel.has(agentPresetServiceToken) && !context.kernel.use(agentPresetServiceToken).list().some((entry) => entry.id === requestedPreset)) {
      throw new RequestError(404, `Unknown agent preset: ${requestedPreset}`, { code: "agent-preset/not-found", details: { agentPreset: requestedPreset, available: context.kernel.use(agentPresetServiceToken).list().map((entry) => entry.id) } });
    }
    if (requestedPreset !== undefined && context.kernel.has(agentPresetServiceToken)) {
      try { await context.kernel.use(agentPresetServiceToken).validate(requestedPreset); }
      catch (error) { throw new RequestError(400, message(error), { code: "agent-preset/invalid", details: { agentPreset: requestedPreset, reason: message(error) } }); }
    }
    let created = await store.create({ id, cwd });
    if (context.kernel.has(agentPresetServiceToken)) {
      const presets = context.kernel.use(agentPresetServiceToken);
      if (requestedPreset !== undefined) await presets.set(id, requestedPreset);
      created = await presets.initialize(created);
    }
    await context.workspaces?.create(cwd);
    await context.dshWorkspaceRegistry?.refresh();
    const currentPreset = context.kernel.has(agentPresetServiceToken) ? await context.kernel.use(agentPresetServiceToken).current(created.id) : undefined;
    json(response, 201, { sessionId: created.id, ...(currentPreset === undefined ? {} : { agentPreset: currentPreset }) }); return;
  }
  if (method === "GET" && url.pathname === "/api/archived-sessions") {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    const archived = new Set(context.workspaces.archivedSessionIds());
    const sessions = await context.kernel.use(sessionStoreToken).list();
    json(response, 200, sessions.filter((session) => archived.has(session.id)).map((session) => sessionSummary(session)).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))));
    return;
  }
  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && sessionMatch !== null) {
    const value = await context.kernel.use(sessionStoreToken).read(sessionId(decodeURIComponent(sessionMatch[1] ?? "")));
    if (value === undefined) json(response, 404, { error: "Session not found" });
    else json(response, 200, { ...value, messages: deriveMessageViews(value) });
    return;
  }
  const sessionMessagesMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
  if (method === "GET" && sessionMessagesMatch !== null) {
    const value = await context.kernel.use(sessionStoreToken).read(sessionId(decodeURIComponent(sessionMessagesMatch[1] ?? "")));
    if (value === undefined) { json(response, 404, { error: "Session not found" }); return; }
    const projection = foldSessionSurface(value.events); const commands = commandMessageViews(value.events); const compactions = compactionMessageViews(value.events); const retries = modelRetryMessageViews(value.events); const prompts = systemPromptMessageViews(value.events); const turnErrors = turnErrorMessageViews(value.events); const maxTokens = turnMaxTokensMessageViews(value.events); const tailSeeds = turnTailMessageViews(value.events); const unknown = unknownSurfaceMessageViews(value.events); const workflows = workflowRunMessageViews(value.events); const transcriptNodes = transcriptNodeSequences(value.events); const total = transcriptNodes.length; const forkMetadata = messageForkMetadata(value, projection.nodes); const tails = new Map([...tailSeeds].map(([sequence, tail]) => [sequence, completedTurnTailView(tail, forkMetadata)])); const steeringSequences = steeringMessageSequences(value.events); const referenceLabels = referenceLabelsByMessageSequence(value.events, projection.nodes); const sessionMetrics = dshSessionMetrics(dshWireHistory(value).records);
    const before = boundedQueryInteger(url, "before", total, 0, total);
    const limit = boundedQueryInteger(url, "limit", 50, 1, 1_000);
    const start = Math.max(0, before - limit); const selected = transcriptNodes.slice(start, before);
    json(response, 200, {
      sessionId: value.id, version: value.version, cwd: sessionCwd(value),
      messages: selected.map((sequence) => { const tail = tails.get(sequence); const max = maxTokens.get(sequence); return commands.get(sequence) ?? compactions.get(sequence) ?? retries.get(sequence) ?? prompts.get(sequence) ?? turnErrors.get(sequence) ?? (max === undefined ? undefined : tail === undefined ? max : { ...tail, role: "turn-max-tokens" as const }) ?? unknown.get(sequence) ?? workflows.get(sequence) ?? tail ?? messageViewAt(value, sequence, forkMetadata, steeringSequences, referenceLabels); }),
      turnOutline: turnOutline(value, projection.nodes, forkMetadata),
      sessionMetrics,
      liveMessages: before === total ? liveAssistantPreview(value.events) : [],
      window: { start, end: before, total, hasMore: start > 0, nextBefore: start > 0 ? start : null },
      replaceGeneration: projection.replaceGeneration,
    });
    return;
  }
  const reviewMatch = /^\/api\/sessions\/([^/]+)\/reviews\/([^/]+)(\/rollback)?$/.exec(url.pathname);
  if (reviewMatch !== null && ((method === "GET" && !reviewMatch[3]) || (method === "POST" && reviewMatch[3]))) {
    const id = sessionId(decodeURIComponent(reviewMatch[1] ?? "")); const snapshotId = decodeURIComponent(reviewMatch[2] ?? "");
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (!session || !context.kernel.has(reviewServiceToken)) throw new RequestError(404, "Review snapshot not found");
    const snapshot = await context.kernel.use(reviewServiceToken).read(id, snapshotId);
    const linked = snapshot && session.events.some(({ event }) => {
      if (event.type !== "tool.completed" || event.payload.callId !== snapshot.callId) return false;
      const details = event.payload.result.details;
      if (!details || typeof details !== "object" || Array.isArray(details)) return false;
      const review = (details as Record<string, unknown>).review;
      return review && typeof review === "object" && !Array.isArray(review) && (review as Record<string, unknown>).snapshotId === snapshot.id;
    });
    if (!snapshot || !linked) throw new RequestError(404, "Review snapshot not found");
    if (method === "POST") {
      const body = await readObject(request);
      if (body.confirm !== true) throw new RequestError(400, "Explicit rollback confirmation is required");
      const service = context.kernel.use(reviewServiceToken);
      if (!service.rollback || !context.kernel.has(policyServiceToken)) throw new RequestError(501, "Rollback is unavailable in this Profile");
      if ([...context.runs.values()].some(run => run.sessionId === id) || (context.kernel.has(agentServiceToken) && context.kernel.use(agentServiceToken).active?.(id))) throw new RequestError(409, "Stop the session before rollback");
      if (context.kernel.has(jobServiceToken) && context.kernel.use(jobServiceToken).list(id).some(job => job.status === "running" || job.status === "stopping")) throw new RequestError(409, "Stop background jobs before rollback");
      if (context.kernel.has(subagentServiceToken)) {
        const agents = context.kernel.use(subagentServiceToken);
        if ((await (agents.listDescendants?.(id) ?? agents.list(id))).some(agent => agent.status === "running")) throw new RequestError(409, "Stop child agents before rollback");
      }
      if (context.kernel.has(terminalServiceToken) && context.kernel.use(terminalServiceToken).list(id).some(terminal => terminal.status === "running")) throw new RequestError(409, "Close session terminals before rollback");
      const cwd = sessionCwd(session);
      if (!cwd) throw new RequestError(409, "Session workspace is unavailable");
      const decision = await context.kernel.use(policyServiceToken).decide({ kind: "tool", toolName: "review.rollback", risk: "workspace-write", summary: `Rollback ${snapshot.path}`, target: resolve(cwd, snapshot.path) }, { sessionId: id, cwd });
      if (decision.outcome !== "allow") throw new RequestError(403, decision.reason ?? "Rollback is not allowed by this Profile");
      const outcome = await service.rollback(id, snapshotId, cwd);
      if (outcome === "conflict" || outcome === "busy") throw new RequestError(409, outcome === "conflict" ? "File changed since this edit; rollback refused" : "Rollback is busy or its lock cannot be safely recovered");
      if (outcome === "unavailable") throw new RequestError(404, "Rollback snapshot unavailable");
      json(response, 200, { outcome }); return;
    }
    json(response, 200, snapshot); return;
  }
  const sessionTitleMatch = /^\/api\/sessions\/([^/]+)\/title$/.exec(url.pathname);
  const sessionTrajectoryMatch = /^\/api\/sessions\/([^/]+)\/trajectory$/.exec(url.pathname);
  if (method === "GET" && sessionTrajectoryMatch !== null) {
    const value = await context.kernel.use(sessionStoreToken).read(sessionId(decodeURIComponent(sessionTrajectoryMatch[1] ?? "")));
    if (value === undefined) { json(response, 404, { error: "Session not found" }); return; }
    const history = dshWireHistory(value); const total = history.records.length; const before = boundedQueryInteger(url, "before", total, 0, total); const limit = boundedQueryInteger(url, "limit", 200, 1, 1_000); const start = Math.max(0, before - limit);
    const records = history.records.slice(start, before).map(({ event }) => ({ seq: event.seq, type: event.type, data: event.data, ...(event.ignorable === undefined ? {} : { ignorable: event.ignorable }), ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }), ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }) }));
    json(response, 200, { sessionId: value.id, records, window: { start, end: before, total, hasMore: start > 0, nextBefore: start > 0 ? start : null } }); return;
  }
  if (method === "PUT" && sessionTitleMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionTitleMatch[1] ?? "")); const body = await readObject(request); const title = requiredString(body, "title");
    const store = context.kernel.use(sessionStoreToken); const current = await store.read(id);
    if (current === undefined) throw new RequestError(404, "Session not found");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("sessionController") as { rename?: (request: { sessionId: string; title: string }) => Promise<{ title: string; seq: number }> } | undefined;
    if (runtime?.sealSessionAuthority === true && controller?.rename !== undefined) {
      const accepted = await controller.rename({ sessionId: id, title });
      const dshSessions = runtime.context.get("sessions") as { get?: (sessionId: string) => unknown; flush?: (session: unknown) => Promise<boolean> } | undefined;
      const liveSession = dshSessions?.get?.(id);
      if (liveSession !== undefined) await dshSessions?.flush?.(liveSession);
      else await (runtime.context.get("agents") as { flushSession?: (sessionId: string) => Promise<boolean> } | undefined)?.flushSession?.(id);
      json(response, 200, { id, title: accepted.title, seq: accepted.seq }); return;
    }
    const normalizedTitle = normalizeSessionTitle(title, 80);
    if (normalizedTitle.length === 0) throw new RequestError(400, "session title must contain visible characters", { code: "session/title-invalid" });
    const updated = await store.append({ id, expectedVersion: current.version, events: [{ type: "session.metadata", payload: { patch: { title: normalizedTitle } } }] });
    json(response, 200, { id, title: normalizedTitle, seq: dshWireHistory(updated).records.at(-1)?.event.seq ?? -1 }); return;
  }
  const sessionModelMatch = /^\/api\/sessions\/([^/]+)\/model$/.exec(url.pathname);
  if (method === "PUT" && sessionModelMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionModelMatch[1] ?? "")); const body = await readObject(request);
    const provider = requiredString(body, "provider"); const model = requiredString(body, "model");
    const reasoningEffort = optionalString(body, "reasoningEffort");
    const known = await context.kernel.use(modelServiceToken).get({ provider, model });
    if (known === undefined) throw new RequestError(404, `Model is unavailable: ${provider}/${model}`, { code: "session/model-unavailable", details: { provider, model } });
    if (reasoningEffort !== undefined && !["off", "low", "medium", "high", "max"].includes(reasoningEffort)) throw new RequestError(400, `Unsupported reasoning effort: ${reasoningEffort}`);
    if (reasoningEffort !== undefined && reasoningEffort !== "off" && known.supportsReasoning !== true) throw new RequestError(404, `Model does not support reasoning: ${provider}/${model}`, { code: "session/model-unavailable", details: { provider, model } });
    const store = context.kernel.use(sessionStoreToken); const current = await store.read(id);
    if (current === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const selected = { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
    await store.append({ id, expectedVersion: current.version, events: [{ type: "session.metadata", payload: { patch: { "sealHarness.modelSelection": selected } } }] });
    json(response, 200, { selected }); return;
  }
  const sessionCancelMatch = /^\/api\/sessions\/([^/]+)\/cancel$/.exec(url.pathname);
  if (method === "POST" && sessionCancelMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionCancelMatch[1] ?? ""));
    const execution = [...context.runs.values()].find((candidate) => candidate.sessionId === id);
    if (execution === undefined) {
      if (await context.kernel.use(sessionStoreToken).read(id) === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
      throw new RequestError(409, `Session "${id}" has no active run`, { code: "session/agent-busy", details: { reason: "no active run" } });
    }
    execution.abort(new Error("Cancelled from DSH Session Remote")); json(response, 202, { accepted: true }); return;
  }
  const sessionPromptMatch = /^\/api\/sessions\/([^/]+)\/prompt$/.exec(url.pathname);
  if (method === "POST" && sessionPromptMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionPromptMatch[1] ?? "")); const body = await readObject(request, 14 * 1024 * 1024);
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const requestId = requiredString(body, "requestId");
    const clientTimeZone = optionalString(body, "clientTimeZone");
    if (clientTimeZone !== undefined) {
      try { new Intl.DateTimeFormat("en", { timeZone: clientTimeZone }).format(); }
      catch { throw new RequestError(400, `Invalid client time zone: ${clientTimeZone}`, { code: "session/invalid-time-zone", details: { value: clientTimeZone } }); }
    }
    const mode = requiredString(body, "mode");
    if (mode !== "queue" && mode !== "steer") throw new RequestError(400, "prompt mode must be queue or steer");
    const content = await remotePromptContent(context, body.content);
    if (content.length === 0) throw new RequestError(400, "prompt content must not be empty");
    const promptMessageId = messageId(randomUUID());
    const active = [...context.runs.values()].find((candidate) => candidate.sessionId === id);
    if (active !== undefined) {
      const message = { id: promptMessageId, role: "user" as const, content, source: { kind: "user-rpc", rpcId: requestId, ...(clientTimeZone === undefined ? {} : { clientTimeZone }) } };
      const runtimeContent = await runtimePromptContent(context, content);
      const runtimeMessage = runtimeContent === content ? message : { ...message, content: runtimeContent };
      if (mode === "steer") active.steer(message, runtimeMessage); else active.followUp(message, runtimeMessage);
      json(response, 202, { accepted: true }); return;
    }
    const saved = modelSelection(session); const fallback = (await context.kernel.use(modelServiceToken).list())[0];
    const selected = saved ?? (fallback === undefined ? undefined : { provider: fallback.provider, model: fallback.model });
    if (selected === undefined) throw new RequestError(409, "No model is available for this Session", { code: "session/model-unavailable", details: { provider: "", model: "" } });
    const cwd = sessionCwd(session);
    if (cwd === undefined) throw new RequestError(409, `Session "${id}" has no working directory`);
    const reasoning = optionalReasoning(selected.reasoningEffort);
    const parked = context.dshControl.take(id);
    const submitted: import("@seal-harness/core").PendingAgentMessage = { id: promptMessageId, placement: mode === "steer" ? "steering" : "queued", message: { id: promptMessageId, role: "user", content, source: { kind: "user-rpc", rpcId: requestId, ...(clientTimeZone === undefined ? {} : { clientTimeZone }) } } };
    const admitted = [...parked, submitted]; const first = admitted.shift()!;
    let execution: AgentExecution;
    try {
      execution = await context.kernel.use(agentServiceToken).prompt({ sessionId: id, cwd, model: selected, prompt: first.message.content, promptMessageId: first.id, ...(first.message.source === undefined ? {} : { promptSource: first.message.source }), ...(reasoning === undefined ? {} : { reasoning }) });
    } catch (error) { context.dshControl.restore(id, parked); throw error; }
    context.runs.set(execution.runId, execution); context.dshControl.track(execution);
    for (const item of admitted) {
      const runtimeContent = await runtimePromptContent(context, item.message.content); const runtimeMessage = runtimeContent === item.message.content ? item.message : { ...item.message, content: runtimeContent };
      if (item.placement === "steering") execution.steer(item.message, runtimeMessage); else execution.followUp(item.message, runtimeMessage);
    }
    void drainDetachedRun(context, execution);
    json(response, 202, { accepted: true }); return;
  }
  const sessionAttachmentContentMatch = /^\/api\/sessions\/([^/]+)\/attachment-content\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && sessionAttachmentContentMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionAttachmentContentMatch[1] ?? "")); const attachmentId = decodeURIComponent(sessionAttachmentContentMatch[2] ?? "");
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const reference = sessionAttachmentReference(session, attachmentId);
    if (reference === undefined || !context.kernel.has(attachmentServiceToken)) throw new RequestError(404, `Attachment is not reachable from Session: ${attachmentId}`, { code: "session/attachment-invalid", details: { reason: "attachment is not reachable from the addressed Session" } });
    const stored = await context.kernel.use(attachmentServiceToken).get(reference);
    if (stored === undefined) throw new RequestError(404, `Attachment data is unavailable: ${attachmentId}`, { code: "session/attachment-invalid", details: { reason: "attachment data is unavailable" } });
    const digest = `sha256:${createHash("sha256").update(stored.data).digest("hex")}`;
    if (digest !== attachmentId) throw new RequestError(409, `Attachment digest mismatch: ${attachmentId}`, { code: "session/attachment-invalid", details: { reason: "stored bytes do not match the attachment id" } });
    const inline = /^(?:image\/(?:png|jpeg|gif|webp)|application\/pdf)$/i.test(stored.mimeType);
    response.writeHead(200, securityHeaders({
      "content-type": stored.mimeType,
      "content-length": String(stored.data.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(stored.name ?? reference.name ?? attachmentId.replace(":", "-"))}`,
      "cache-control": "private, max-age=31536000, immutable",
    }));
    response.end(stored.data); return;
  }
  const sessionAttachmentMatch = /^\/api\/sessions\/([^/]+)\/attachments\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && sessionAttachmentMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionAttachmentMatch[1] ?? "")); const attachmentId = decodeURIComponent(sessionAttachmentMatch[2] ?? "");
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const reference = sessionAttachmentReference(session, attachmentId);
    if (reference === undefined || !context.kernel.has(attachmentServiceToken)) throw new RequestError(404, `Attachment is not reachable from Session: ${attachmentId}`, { code: "session/attachment-invalid", details: { reason: "attachment is not reachable from the addressed Session" } });
    const stored = await context.kernel.use(attachmentServiceToken).get(reference);
    if (stored === undefined) throw new RequestError(404, `Attachment data is unavailable: ${attachmentId}`, { code: "session/attachment-invalid", details: { reason: "attachment data is unavailable" } });
    const digest = `sha256:${createHash("sha256").update(stored.data).digest("hex")}`;
    if (digest !== attachmentId) throw new RequestError(409, `Attachment digest mismatch: ${attachmentId}`, { code: "session/attachment-invalid", details: { reason: "stored bytes do not match the attachment id" } });
    let dimensions: { width: number; height: number };
    try { dimensions = imageDimensions(stored.data, stored.mimeType); }
    catch (error) { throw new RequestError(409, message(error), { code: "session/attachment-invalid", details: { reason: message(error) } }); }
    json(response, 200, { attachment: { attachmentId, mediaType: stored.mimeType, bytes: stored.data.byteLength, ...dimensions, ...(stored.name === undefined ? {} : { name: stored.name }), ...(reference.originalDimensions === undefined ? {} : { originalDimensions: reference.originalDimensions }) }, data: Buffer.from(stored.data).toString("base64") }); return;
  }
  const sessionForkMatch = /^\/api\/sessions\/([^/]+)\/fork$/.exec(url.pathname);
  if (method === "POST" && sessionForkMatch !== null) {
    const sourceId = sessionId(decodeURIComponent(sessionForkMatch[1] ?? "")); const body = await readObject(request);
    const atSeq = body.atSeq;
    if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || (atSeq as number) < 0)) throw new RequestError(400, "atSeq must be a non-negative safe integer");
    const source = await context.kernel.use(sessionStoreToken).read(sourceId);
    if (source === undefined) throw new RequestError(404, `Session not found: ${sourceId}`, { code: "session/not-found", details: { sessionId: sourceId } });
    const history = dshWireHistory(source); const completedWire = history.records.filter((entry) => entry.event.type === "turn/end");
    const boundaryWire = atSeq === undefined || (atSeq as number) > history.records.length - 1 ? completedWire.at(-1) : completedWire.find((entry) => entry.event.seq >= (atSeq as number));
    const boundarySequence = boundaryWire === undefined ? undefined : history.sealSequences[boundaryWire.event.seq];
    if (boundarySequence === undefined) throw new RequestError(409, `Session "${sourceId}" has no completed turn to fork from`, { code: "session/fork-unavailable", details: { sessionId: sourceId } });
    const fork = await context.kernel.use(agentServiceToken).fork({ sourceSessionId: sourceId, throughVersion: boundarySequence });
    await context.dshWorkspaceRegistry?.refresh();
    json(response, 201, { sessionId: fork.id }); return;
  }
  const sessionArchiveMatch = /^\/api\/sessions\/([^/]+)\/archived$/.exec(url.pathname);
  if (url.pathname === "/api/provider-login") {
    const service = context.kernel.use(modelServiceToken);
    if (!(service instanceof PiAiModelService)) throw new RequestError(501, "PI login unavailable");
    if (method === "GET") {
      const id = url.searchParams.get("id");
      if (id) { json(response, 200, service.logins.read(id)); return; }
      const provider = url.searchParams.get("provider") ?? "";
      const auth = service.models.getProvider(provider)?.auth;
      json(response, 200, { oauth: Boolean(auth?.oauth), apiKeySetup: Boolean(auth?.apiKey?.login), configured: Boolean(await service.models.checkAuth(provider)) }); return;
    }
    const body = await readObject(request);
    if (method === "POST") {
      if (body.action === "start" && typeof body.provider === "string" && (body.type === "oauth" || body.type === "api_key")) {
        if (!context.kernel.has(credentialServiceToken) || !context.kernel.use(credentialServiceToken).modifyRecord) throw new RequestError(501, "Persistent login storage unavailable");
        json(response, 200, { id: service.logins.start(body.provider, body.type) }); return;
      }
      if (body.action === "answer" && typeof body.id === "string" && typeof body.promptId === "string" && typeof body.value === "string") {
        service.logins.answer(body.id, body.promptId, body.value); json(response, 200, { ok: true }); return;
      }
    }
    if (method === "DELETE") {
      if (typeof body.id === "string") service.logins.cancel(body.id);
      else if (typeof body.provider === "string") { service.logins.cancelProvider(body.provider); await service.models.logout(body.provider); }
      else throw new RequestError(400, "Missing login id or provider");
      json(response, 200, { ok: true }); return;
    }
    throw new RequestError(400, "Invalid login request");
  }
  const sessionDeleteMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && sessionDeleteMatch !== null) {
    const id = sessionId(decodeURIComponent(sessionDeleteMatch[1] ?? ""));
    if (!await context.kernel.use(sessionStoreToken).read(id)) throw new RequestError(404, "Session not found");
    if ([...context.runs.values()].some((run) => run.sessionId === id)) throw new RequestError(409, "Stop the running session before deleting it");
    if (context.kernel.has(jobServiceToken) && context.kernel.use(jobServiceToken).list(id).some(job => job.status === "running" || job.status === "stopping")) throw new RequestError(409, "Stop background jobs before deleting this session");
    if (context.kernel.has(subagentServiceToken) && (await context.kernel.use(subagentServiceToken).list(id)).some(child => child.status === "running")) throw new RequestError(409, "Stop child agents before deleting this session");
    if (context.kernel.has(scheduleServiceToken) && (await context.kernel.use(scheduleServiceToken).list(id)).length > 0) throw new RequestError(409, "Remove scheduled tasks before deleting this session");
    if (context.kernel.has(terminalServiceToken) && context.kernel.use(terminalServiceToken).list(id).some(terminal => terminal.status === "running")) throw new RequestError(409, "Close terminals before deleting this session");
    const store = context.kernel.use(sessionStoreToken);
    if (!store.delete) throw new RequestError(501, "This session store does not support deletion");
    if (!await store.read(id)) throw new RequestError(404, "Session not found");
    await context.workspaces?.archiveSession(id, false);
    if (!await store.delete(id)) throw new RequestError(404, "Session not found");
    await context.dshWorkspaceRegistry?.refresh();
    json(response, 200, { deleted: true }); return;
  }
  if (method === "PUT" && sessionArchiveMatch !== null) {
    if (context.workspaces === undefined) throw new RequestError(501, "Workspace registry is not available in this Profile");
    const body = await readObject(request);
    if (typeof body.archived !== "boolean") throw new RequestError(400, "archived must be a boolean");
    await context.workspaces.archiveSession(sessionId(decodeURIComponent(sessionArchiveMatch[1] ?? "")), body.archived);
    await context.dshWorkspaceRegistry?.refresh();
    json(response, 200, { archived: body.archived }); return;
  }
  const commandMatch = /^\/api\/sessions\/([^/]+)\/commands$/.exec(url.pathname);
  if (method === "POST" && commandMatch !== null) {
    const id = sessionId(decodeURIComponent(commandMatch[1] ?? ""));
    const body = await readObject(request); const line = requiredString(body, "line");
    const dshRuntime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const dshCommands = dshRuntime?.context.get("commands") as { execute?: (agent: unknown, line: string, images: readonly unknown[], signal: AbortSignal) => Promise<unknown> } | undefined;
    const dshAgents = dshRuntime?.context.get("agents") as { get?: (id: string) => unknown; resume?: (options: { resumeSessionId: string }) => Promise<{ readonly agent: unknown; dispose(): Promise<void> }> } | undefined;
    if (dshCommands?.execute !== undefined && dshAgents !== undefined) {
      let temporary: { readonly agent: unknown; dispose(): Promise<void> } | undefined;
      const live = dshAgents.get?.(id);
      if (live === undefined && dshAgents.resume !== undefined) temporary = await dshAgents.resume({ resumeSessionId: id });
      const agent = live ?? temporary?.agent;
      if (agent === undefined) throw new RequestError(404, `Session ${JSON.stringify(id)} was not found`, { code: "session/not-found", details: { sessionId: id } });
      const abort = new AbortController(); request.once("aborted", () => abort.abort(new Error("Command request cancelled")));
      try { json(response, 200, await dshCommands.execute(agent, line, Array.isArray(body.images) ? body.images : [], abort.signal) ?? null); }
      finally { await temporary?.dispose(); }
      return;
    }
    if (!context.kernel.has(commandServiceToken)) throw new RequestError(501, "Commands are not available in this Profile");
    if (await context.kernel.use(sessionStoreToken).read(id) === undefined) throw new RequestError(404, "Session not found");
    if (body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 0)) {
      throw new RequestError(400, "Command image attachments are not supported by this Profile");
    }
    const execution = await context.kernel.use(commandServiceToken).execute(id, line);
    json(response, 200, execution ?? null);
    return;
  }
  const feedbackListMatch = /^\/api\/sessions\/([^/]+)\/feedback$/.exec(url.pathname);
  if (method === "POST" && url.pathname === "/api/dsh/message-feedback") {
    const body = await readObject(request);
    const operation = requiredString(body, "operation");
    if (operation !== "list" && operation !== "put" && operation !== "delete") throw new RequestError(400, "message feedback operation must be list, put, or delete");
    const requestBody = body.request;
    if (requestBody === null || typeof requestBody !== "object" || Array.isArray(requestBody)) throw new RequestError(400, "message feedback request must be an object");
    const input = requestBody as JsonObject;
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const official = runtime?.context.get("messageFeedback") as Record<string, ((request: JsonObject) => Promise<unknown>) | undefined> | undefined;
    const invoke = official?.[operation];
    if (invoke !== undefined) { json(response, 200, await invoke.call(official, input)); return; }
    if (!context.kernel.has(messageFeedbackServiceToken)) throw new RequestError(501, "Message feedback is not available in this Profile");
    const id = sessionId(requiredString(input, "sessionId"));
    const feedback = context.kernel.use(messageFeedbackServiceToken);
    try {
      if (operation === "list") {
        json(response, 200, { ok: true, value: { items: (await feedback.list(id)).map(webDshFeedbackItem) } });
      } else {
        const target = requiredString(input, "messageId");
        const ifVersion = input.ifVersion === null ? null : requiredString(input, "ifVersion");
        if (operation === "put") {
          if (input.rating !== "positive" && input.rating !== "negative") throw new RequestError(400, "rating must be positive or negative");
          const note = optionalString(input, "note");
          const item = await feedback.put({ sessionId: id, messageId: target, rating: input.rating === "positive" ? "up" : "down", ...(note === undefined ? {} : { note }), ifVersion });
          json(response, 200, { ok: true, value: webDshFeedbackItem(item) });
        } else if (operation === "delete") {
          await feedback.delete({ sessionId: id, messageId: target, ifVersion });
          json(response, 200, { ok: true, value: { absent: true } });
        }
      }
    } catch (error) {
      if (!(error instanceof MessageFeedbackError)) throw error;
      json(response, 200, webDshFeedbackFailure(error, input, feedback.maxNoteBytes));
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/goals") {
    const body = await readObject(request);
    const operation = requiredString(body, "operation");
    if (!["create", "edit", "pause", "resume", "complete", "clear"].includes(operation)) throw new RequestError(400, `Unknown goal operation: ${operation}`);
    const id = sessionId(requiredString(body, "sessionId"));
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const agents = runtime?.context.get("agents") as { get?: (id: string) => unknown; resume?: (request: { resumeSessionId: string }) => Promise<{ agent: unknown; dispose(): Promise<void> }> } | undefined;
    const goals = runtime?.context.get("goals") as Record<string, ((...args: unknown[]) => unknown) | undefined> | undefined;
    const invoke = goals?.[operation];
    if (agents === undefined || invoke === undefined) { json(response, 200, { available: false }); return; }
    let resumed: { agent: unknown; dispose(): Promise<void> } | undefined;
    const agent = agents.get?.(id) ?? (agents.resume === undefined ? undefined : (resumed = await agents.resume({ resumeSessionId: id })).agent);
    if (agent === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    try {
      const ref = body.ref;
      const requestBody = body.request;
      const value = operation === "create"
        ? await invoke.call(goals, agent, requestBody)
        : operation === "edit"
          ? await invoke.call(goals, agent, ref, requestBody)
          : await invoke.call(goals, agent, ref);
      json(response, 200, { available: true, value });
    } finally { await resumed?.dispose(); }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/subagents") {
    const body = await readObject(request);
    const operation = requiredString(body, "operation");
    if (operation !== "list" && operation !== "prompt" && operation !== "interruptByParent") throw new RequestError(400, "subagent operation must be list, prompt, or interruptByParent");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const official = runtime?.context.get("subagents") as {
      remoteExportList?: (parentSessionId: string, signal: AbortSignal) => Promise<unknown>;
      prompt?: (request: JsonObject, signal: AbortSignal) => Promise<unknown>;
      interruptByParent?: (childSessionId: string, parentSessionId: string, mode: "continuable") => unknown;
    } | undefined;
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    if (operation === "list" && official?.remoteExportList !== undefined) {
      json(response, 200, await official.remoteExportList(requiredString(body, "parentSessionId"), abort.signal)); return;
    }
    if (operation === "prompt" && official?.prompt !== undefined) {
      const requestBody = { ...body }; delete requestBody.operation;
      json(response, 200, await official.prompt(requestBody, abort.signal)); return;
    }
    if (operation === "interruptByParent" && official?.interruptByParent !== undefined) {
      if (body.mode !== "continuable") throw new RequestError(400, "subagent interrupt mode must be continuable", { code: "gateway/bad-request", details: {} });
      json(response, 200, await official.interruptByParent(requiredString(body, "childSessionId"), requiredString(body, "parentSessionId"), "continuable")); return;
    }
    if (!context.kernel.has(subagentServiceToken)) throw new RequestError(501, "Subagents are not available in this Profile");
    const subagents = context.kernel.use(subagentServiceToken);
    if (operation === "list") {
      const parentSessionId = sessionId(requiredString(body, "parentSessionId"));
      const children = await subagents.list(parentSessionId);
      const entries = await Promise.all(children.map(async child => ({
        kind: "child" as const,
        id: child.sessionId,
        activity: child.status === "running" ? "running" as const : "inactive" as const,
        mode: "continuable" as const,
        label: child.label,
        hasChildren: (await subagents.list(child.sessionId)).length > 0,
      })));
      const parentAvailable = await context.kernel.use(sessionStoreToken).read(parentSessionId) !== undefined;
      json(response, 200, { entries, parentAvailable });
    } else if (operation === "prompt") {
      if (body.mode !== "continuable") throw new RequestError(400, "subagent prompt mode must be continuable", { code: "gateway/bad-request", details: {} });
      const parentSessionId = sessionId(requiredString(body, "parentSessionId"));
      const childSessionId = sessionId(requiredString(body, "childSessionId"));
      const requestId = requiredString(body, "requestId");
      const clientTimeZone = optionalString(body, "clientTimeZone");
      if (clientTimeZone !== undefined) {
        try { new Intl.DateTimeFormat("en", { timeZone: clientTimeZone }).format(); }
        catch { throw new RequestError(400, `Invalid client time zone: ${clientTimeZone}`, { code: "subagent/invalid-time-zone", details: { value: clientTimeZone } }); }
      }
      const content = await remotePromptContent(context, body.content);
      const id = messageId(`subagent-prompt-${requestId}`);
      try {
        const accepted = subagents.sendMessage === undefined
          ? (await subagents.send(parentSessionId, childSessionId, { id, role: "user", content, source: { kind: "user-rpc", rpcId: requestId, ...(clientTimeZone === undefined ? {} : { clientTimeZone }) } }), id)
          : await subagents.sendMessage(parentSessionId, childSessionId, { id, role: "user", content, source: { kind: "user-rpc", rpcId: requestId, ...(clientTimeZone === undefined ? {} : { clientTimeZone }) } });
        json(response, 200, { messageId: accepted });
      } catch (error) {
        throw new RequestError(409, message(error), { code: /not directly|not descended|not owned|does not belong/i.test(message(error)) ? "subagent/unauthorized" : "subagent/not-resumable", details: { childSessionId } });
      }
    } else if (operation === "interruptByParent") {
      if (body.mode !== "continuable") throw new RequestError(400, "subagent interrupt mode must be continuable", { code: "gateway/bad-request", details: {} });
      const parentSessionId = sessionId(requiredString(body, "parentSessionId"));
      const childSessionId = sessionId(requiredString(body, "childSessionId"));
      try { await subagents.abort(parentSessionId, childSessionId, new Error("Interrupted from DSH Web Client")); }
      catch (error) { throw new RequestError(409, message(error), { code: "subagent/unauthorized", details: { childSessionId } }); }
      json(response, 200, { accepted: true });
    }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/agent-teams") {
    if (!context.kernel.has(teamServiceToken)) throw new RequestError(501, "Agent Teams are not available in this Profile");
    const body = await readObject(request); const operation = requiredString(body, "operation"); const caller = sessionId(requiredString(body, "sessionId")); const teams = context.kernel.use(teamServiceToken);
    const teamRequest = body.request;
    if (operation === "view") json(response, 200, await teams.view(caller));
    else if (operation === "createTask") { if (typeof teamRequest !== "object" || teamRequest === null || Array.isArray(teamRequest)) throw new RequestError(400, "request must be an object"); json(response, 200, await teams.createTask(caller, teamRequest as never)); }
    else if (operation === "updateTask") { if (typeof teamRequest !== "object" || teamRequest === null || Array.isArray(teamRequest)) throw new RequestError(400, "request must be an object"); json(response, 200, await teams.updateTask(caller, teamRequest as never)); }
    else throw new RequestError(400, "Agent Team operation must be view, createTask, or updateTask");
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/session-references") {
    const body = await readObject(request);
    const currentId = sessionId(requiredString(body, "sessionId"));
    const query = optionalString(body, "query") ?? "";
    const store = context.kernel.use(sessionStoreToken);
    const current = await store.read(currentId);
    if (current === undefined) throw new RequestError(404, `Session not found: ${currentId}`, { code: "session/not-found", details: { sessionId: currentId } });
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const agents = runtime?.context.get("agents") as { get?: (id: string) => unknown; resume?: (request: { resumeSessionId: string }) => Promise<{ agent: unknown; dispose(): Promise<void> }> } | undefined;
    let resumed: { agent: unknown; dispose(): Promise<void> } | undefined;
    const agent = agents?.get?.(currentId) ?? (agents?.resume === undefined ? undefined : (resumed = await agents.resume({ resumeSessionId: currentId })).agent);
    const presets = runtime?.context.get("agentPresets") as { serviceFor?: (agent: unknown, service: string) => unknown } | undefined;
    const scoped = agent === undefined ? undefined : presets?.serviceFor?.(agent, "sessionReferenceResolver");
    const official = (scoped ?? runtime?.context.get("sessionReferenceResolver")) as { remoteExportCandidates?: (agent: unknown, query: string, signal: AbortSignal) => Promise<unknown> } | undefined;
    if (agent !== undefined && official?.remoteExportCandidates !== undefined) {
      try { json(response, 200, await official.remoteExportCandidates(agent, query, abort.signal)); }
      finally { await resumed?.dispose(); }
      return;
    }
    try {
      const targetCwd = sessionCwd(current);
      const needle = query.toLocaleLowerCase();
      const ranked = (await store.list()).filter(candidate => candidate.id !== currentId).map((candidate, index) => {
        const cwd = sessionCwd(candidate);
        const label = sessionTitle(candidate) ?? candidate.id;
        const created = candidate.events.find(entry => entry.event.type === "session.created")?.timestamp;
        return { candidate, index, cwd, label, createdAt: created === undefined ? 0 : Date.parse(created) || 0, rank: cwd !== undefined && targetCwd !== undefined && cwd === targetCwd ? 0 : cwd === undefined ? 1 : 2 };
      }).filter(entry => needle === "" || entry.candidate.id.toLocaleLowerCase().includes(needle) || entry.cwd?.toLocaleLowerCase().includes(needle) === true || entry.label.toLocaleLowerCase().includes(needle))
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .slice(0, 50)
        .map(entry => ({ sessionId: entry.candidate.id, label: entry.label, ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }), sameWorkspace: entry.cwd !== undefined && entry.cwd === targetCwd, createdAt: entry.createdAt, mention: dshSessionMention(entry.candidate.id, entry.label) }));
      json(response, 200, ranked);
    }
    finally { await resumed?.dispose(); }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/file-references") {
    const body = await readObject(request);
    const id = sessionId(requiredString(body, "sessionId"));
    const query = optionalString(body, "query") ?? "";
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const cwd = sessionCwd(session);
    if (cwd === undefined) throw new RequestError(409, `Session has no workspace: ${id}`, { code: "session/workspace-unavailable", details: { sessionId: id } });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const agents = runtime?.context.get("agents") as { get?: (id: string) => unknown; resume?: (request: { resumeSessionId: string }) => Promise<{ agent: unknown; dispose(): Promise<void> }> } | undefined;
    let resumed: { agent: unknown; dispose(): Promise<void> } | undefined;
    const agent = agents?.get?.(id) ?? (agents?.resume === undefined ? undefined : (resumed = await agents.resume({ resumeSessionId: id })).agent);
    const presets = runtime?.context.get("agentPresets") as { serviceFor?: (agent: unknown, service: string) => unknown } | undefined;
    const scoped = agent === undefined ? undefined : presets?.serviceFor?.(agent, "fileReferences");
    const official = (scoped ?? runtime?.context.get("fileReferences")) as { list?: (agent: unknown, query: string, signal: AbortSignal) => Promise<unknown> } | undefined;
    const controller = new AbortController();
    request.once("aborted", () => controller.abort(new Error("File-reference request cancelled")));
    if (agent !== undefined && official?.list !== undefined) {
      try { json(response, 200, await official.list(agent, query, controller.signal)); }
      finally { await resumed?.dispose(); }
      return;
    }
    const search = new WorkspaceFileSearch(cwd, { maxResults: DEFAULT_FILE_SEARCH_MAX_RESULTS, maxEntries: DEFAULT_FILE_SEARCH_MAX_ENTRIES, excludedDirectories: DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES });
    try { json(response, 200, await search.list(query, controller.signal)); }
    finally { search.dispose(); await resumed?.dispose(); }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/workspace") {
    const body = await readObject(request);
    const operation = requiredString(body, "operation");
    if (!["create", "rename", "delete", "insertBefore", "insertSessionBefore", "archiveSession"].includes(operation)) throw new RequestError(400, `Unknown workspace operation: ${operation}`);
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("workspaceController") as Record<string, ((request: JsonObject, signal?: AbortSignal) => Promise<unknown>) | undefined> | undefined;
    const invoke = controller?.[operation];
    if (invoke === undefined) { json(response, 200, { available: false }); return; }
    const abort = new AbortController(); response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    const requestBody = { ...body }; delete requestBody.operation;
    json(response, 200, { available: true, value: await invoke.call(controller, requestBody, abort.signal) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/llm/discover-models") {
    const body = await readObject(request);
    const settingsNs = requiredString(body, "settingsNs");
    if (settingsNs !== "llm-pi-ai" && settingsNs !== "llm-deepseek" && settingsNs !== "provider-pi-ai") {
      throw new RequestError(409, `No model discovery is registered for ${settingsNs}`, { code: "llm/model-discovery-rejected", details: { settingsNs } });
    }
    const provider = optionalString(body, "provider");
    const baseURL = optionalString(body, "baseURL");
    if (provider === undefined && baseURL === undefined) throw new RequestError(400, "Model discovery needs a provider route or a baseURL", { code: "llm/model-discovery-rejected", details: { settingsNs } });
    const controller = new AbortController();
    request.once("aborted", () => controller.abort(new Error("Model discovery cancelled")));
    try {
      if (baseURL === undefined && provider !== undefined) {
        const models = (await context.kernel.use(modelServiceToken).list()).filter(model => model.provider === provider).map(model => ({ id: model.model, ...(model.displayName === undefined ? {} : { name: model.displayName }), contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens }));
        json(response, 200, models); return;
      }
      const apiKey = optionalString(body, "apiKey");
      const discovered = await discoverProviderModels({ baseUrl: baseURL!, ...(apiKey === undefined ? {} : { apiKey }), signal: controller.signal });
      json(response, 200, discovered.map(model => ({ id: model.id, ...(model.name === undefined ? {} : { name: model.name }), ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }), ...(model.maxOutputTokens === undefined ? {} : { maxTokens: model.maxOutputTokens }) })));
    } catch (error) {
      throw new RequestError(409, message(error), { code: "llm/model-discovery-rejected", details: { settingsNs, ...(baseURL === undefined ? {} : { baseURL }) } });
    }
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/llm/configurable-providers") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const llm = runtime?.context.get("llm") as { listConfigurableProviders?: () => unknown } | undefined;
    json(response, 200, llm?.listConfigurableProviders?.() ?? []);
    return;
  }
  if (method === "GET" && url.pathname === "/api/dsh/llm/providers") {
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const llm = runtime?.context.get("llm") as { listProviders?: () => unknown } | undefined;
    if (llm?.listProviders !== undefined) { json(response, 200, llm.listProviders()); return; }
    const seen = new Set<string>();
    const providers = (await context.kernel.use(modelServiceToken).list()).flatMap((model) => {
      if (seen.has(model.provider)) return [];
      seen.add(model.provider);
      return [{ id: model.provider, name: model.provider }];
    });
    json(response, 200, providers);
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/credentials") {
    const body = await readObject(request); const operation = requiredString(body, "operation");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const controller = runtime?.context.get("credentialsController") as { describe?: (refs: string[]) => Promise<unknown>; set?: (ref: string, value: string) => Promise<void>; unset?: (ref: string) => Promise<void> } | undefined;
    if (controller !== undefined) {
      if (operation === "describe" && controller.describe !== undefined) { json(response, 200, await controller.describe(body.refs as string[])); return; }
      if (operation === "set" && controller.set !== undefined) { await controller.set(body.ref as string, body.value as string); response.writeHead(204, securityHeaders({ "cache-control": "no-store" })); response.end(); return; }
      if (operation === "unset" && controller.unset !== undefined) { await controller.unset(body.ref as string); response.writeHead(204, securityHeaders({ "cache-control": "no-store" })); response.end(); return; }
      throw new RequestError(400, "credential operation must be describe, set, or unset");
    }
    if (!context.kernel.has(credentialServiceToken)) throw new RequestError(501, "Credential service is not available in this Profile");
    const credentials = context.kernel.use(credentialServiceToken);
    const validRef = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
    if (operation === "describe") {
      if (!Array.isArray(body.refs) || body.refs.length > 64 || body.refs.some(ref => !validRef(ref))) throw new RequestError(400, "Invalid payload for credentials.describe");
      if (credentials.describeRef === undefined) throw new RequestError(501, "Credential provider cannot describe references");
      const entries = await Promise.all(body.refs.map(async ref => [ref as string, await credentials.describeRef!(ref as string)] as const));
      json(response, 200, Object.fromEntries(entries));
    } else if (operation === "set") {
      if (!validRef(body.ref) || typeof body.value !== "string" || body.value.length === 0) throw new RequestError(400, "Invalid payload for credentials.set");
      if (credentials.setRef === undefined) throw new RequestError(501, "Credential provider is read-only");
      try { await credentials.setRef(body.ref, body.value); }
      catch (error) { throw new RequestError(409, message(error), { code: "credential/rejected", details: { ref: body.ref } }); }
      response.writeHead(204, securityHeaders({ "cache-control": "no-store" })); response.end();
    } else if (operation === "unset") {
      if (!validRef(body.ref)) throw new RequestError(400, "Invalid payload for credentials.unset");
      if (credentials.unsetRef === undefined) throw new RequestError(501, "Credential provider is read-only");
      try { await credentials.unsetRef(body.ref); }
      catch (error) { throw new RequestError(409, message(error), { code: "credential/rejected", details: { ref: body.ref } }); }
      response.writeHead(204, securityHeaders({ "cache-control": "no-store" })); response.end();
    } else throw new RequestError(400, "credential operation must be describe, set, or unset");
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/skills") {
    const body = await readObject(request); const id = sessionId(requiredString(body, "sessionId"));
    const session = await context.kernel.use(sessionStoreToken).read(id);
    if (session === undefined) throw new RequestError(404, `Session not found: ${id}`, { code: "session/not-found", details: { sessionId: id } });
    const cwd = sessionCwd(session);
    if (cwd === undefined) throw new RequestError(500, `Session ${id} has no project cwd`, { code: "gateway/internal", details: {} });
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    type SkillRegistry = { list(options: { cwd: string; scope?: unknown }): Promise<readonly { name: string; description: string; whenToUse?: string; invocation: { modelInvocable: boolean; userInvocable: boolean } }[]> };
    const agents = runtime?.context.get("agents") as { get?: (id: string) => unknown } | undefined;
    const presets = runtime?.context.get("agentPresets") as { serviceFor?: (agent: unknown, service: string) => unknown; standingKeyFor?: (preset?: string) => Promise<unknown> } | undefined;
    const live = agents?.get?.(id);
    const scoped = live === undefined ? undefined : presets?.serviceFor?.(live, "skills") as SkillRegistry | undefined;
    const skills = scoped ?? runtime?.context.get("skills") as SkillRegistry | undefined;
    if (skills === undefined) throw new RequestError(500, "DSH skill registry is not available in this Profile", { code: "gateway/internal", details: {} });
    try {
      const currentPreset = context.kernel.has(agentPresetServiceToken) ? await context.kernel.use(agentPresetServiceToken).current(id) : undefined;
      const scope = live ?? await presets?.standingKeyFor?.(currentPreset);
      const listed = (await skills.list({ cwd, ...(scope === undefined ? {} : { scope }) })).filter(skill => skill.invocation.userInvocable).map(skill => ({ name: skill.name, description: skill.description, ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }), modelInvocable: skill.invocation.modelInvocable }));
      json(response, 200, { skills: listed });
    } catch (error) { throw new RequestError(500, `Skill listing failed: ${message(error)}`, { code: "gateway/internal", details: {} }); }
    return;
  }
  if (method === "POST" && url.pathname === "/api/dsh/directory-picker") {
    const body = await readObject(request); const operation = requiredString(body, "operation");
    const runtime = context.kernel.has(dshCompatServiceToken) ? context.kernel.use(dshCompatServiceToken) : undefined;
    const picker = runtime?.context.get("directoryPicker") as { capability(): { kind: string; list?(path: string | undefined, signal: AbortSignal): Promise<unknown>; createDirectory?(path: string, name: string): Promise<string>; pick?(signal: AbortSignal): Promise<string | null> } } | undefined;
    if (picker === undefined) throw new RequestError(501, "DSH directory picker is not available in this Profile");
    const capability = picker.capability(); const controller = new AbortController(); request.once("aborted", () => controller.abort(new Error("Directory picker request cancelled")));
    try {
      if (operation === "list") {
        if (capability.kind !== "browse" || capability.list === undefined) throw new RequestError(409, "Directory listing is unavailable", { code: "directory-picker/unavailable", details: { capability: capability.kind } });
        json(response, 200, await capability.list(optionalString(body, "path"), controller.signal));
      } else if (operation === "createDirectory") {
        const path = requiredString(body, "path"); const name = requiredString(body, "name");
        if (name.trim() === "" || name === "." || name === ".." || /[/\\]/.test(name)) throw new RequestError(400, "Invalid directory name");
        if (capability.kind !== "browse" || capability.createDirectory === undefined) throw new RequestError(409, "Directory creation is unavailable", { code: "directory-picker/unavailable", details: { capability: capability.kind } });
        json(response, 200, await capability.createDirectory(path, name));
      } else if (operation === "pick") {
        if (capability.kind !== "native" || capability.pick === undefined) throw new RequestError(409, "Native directory picking is unavailable", { code: "directory-picker/unavailable", details: { capability: capability.kind } });
        json(response, 200, await capability.pick(controller.signal));
      } else throw new RequestError(400, "directory picker operation must be pick, list, or createDirectory");
    } catch (error) {
      if (error instanceof RequestError) throw error;
      const candidate = error as { code?: unknown; path?: unknown };
      const code = candidate.code === "directory-unreadable" ? "directory-picker/unreadable" : candidate.code === "directory-exists" ? "directory-picker/exists" : candidate.code === "directory-create-failed" ? "directory-picker/create-failed" : undefined;
      throw new RequestError(code === undefined ? 500 : 409, message(error), code === undefined ? undefined : { code, details: { path: typeof candidate.path === "string" ? candidate.path : optionalString(body, "path") ?? "" } });
    }
    return;
  }
  if (method === "GET" && feedbackListMatch !== null) {
    if (!context.kernel.has(messageFeedbackServiceToken)) throw new RequestError(501, "Message feedback is not available in this Profile");
    json(response, 200, await context.kernel.use(messageFeedbackServiceToken).list(sessionId(decodeURIComponent(feedbackListMatch[1] ?? ""))));
    return;
  }
  const feedbackMatch = /^\/api\/sessions\/([^/]+)\/feedback\/([^/]+)$/.exec(url.pathname);
  if ((method === "PUT" || method === "DELETE") && feedbackMatch !== null) {
    if (!context.kernel.has(messageFeedbackServiceToken)) throw new RequestError(501, "Message feedback is not available in this Profile");
    const body = await readObject(request); const id = sessionId(decodeURIComponent(feedbackMatch[1] ?? "")); const messageId = decodeURIComponent(feedbackMatch[2] ?? "");
    const ifVersion = body.ifVersion === null ? null : optionalString(body, "ifVersion") ?? null;
    if (method === "DELETE") json(response, 200, { deleted: await context.kernel.use(messageFeedbackServiceToken).delete({ sessionId: id, messageId, ifVersion }) });
    else {
      if (body.rating !== "up" && body.rating !== "down") throw new RequestError(400, "rating must be up or down");
      const note = optionalString(body, "note");
      json(response, 200, await context.kernel.use(messageFeedbackServiceToken).put({ sessionId: id, messageId, rating: body.rating, ...(note === undefined ? {} : { note }), ifVersion }));
    }
    return;
  }
  const sessionGoalMatch = /^\/api\/sessions\/([^/]+)\/goal$/.exec(url.pathname);
  if (sessionGoalMatch !== null && (method === "POST" || method === "PUT" || method === "DELETE")) {
    if (!context.kernel.has(goalServiceToken)) throw new RequestError(501, "Goals are not available in this Profile");
    const id = sessionId(decodeURIComponent(sessionGoalMatch[1] ?? ""));
    const body = await readObject(request);
    const goals = context.kernel.use(goalServiceToken);
    try {
      if (method === "POST") {
        const objective = requiredString(body, "objective");
        const maxGoalRounds = optionalPositiveInteger(body, "maxGoalRounds");
        const goal = await goals.create(id, { objective, ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) });
        json(response, 201, { ref: { id: goal.id, revision: goal.revision } });
      } else {
        const ref = { id: requiredString(body, "id"), revision: requiredPositiveInteger(body, "revision") };
        if (method === "DELETE") json(response, 200, await goals.clear(id, ref));
        else {
          const action = requiredString(body, "action");
          if (action === "edit") {
            const objective = optionalString(body, "objective");
            const maxGoalRounds = optionalPositiveInteger(body, "maxGoalRounds");
            json(response, 200, await goals.edit(id, ref, { ...(objective === undefined ? {} : { objective }), ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) }));
          } else if (action === "pause") json(response, 200, await goals.pause(id, ref));
          else if (action === "resume") json(response, 200, await goals.resume(id, ref));
          else if (action === "complete") json(response, 200, await goals.complete(id, ref));
          else throw new RequestError(400, "goal action must be edit, pause, resume, or complete");
        }
      }
    } catch (error) {
      if (error instanceof GoalError) throw new RequestError(409, error.message, { code: `goal/${error.code.toLowerCase().replaceAll("_", "-")}`, details: {} });
      throw error;
    }
    return;
  }
  const planMatch = /^\/api\/sessions\/([^/]+)\/plan$/.exec(url.pathname);
  if ((method === "GET" || method === "PUT") && planMatch !== null) {
    if (!context.kernel.has(planModeServiceToken)) throw new RequestError(501, "Plan mode is not available in this Profile");
    const id = sessionId(decodeURIComponent(planMatch[1] ?? ""));
    const service = context.kernel.use(planModeServiceToken);
    if (method === "GET") json(response, 200, await service.get(id));
    else {
      const body = await readObject(request);
      if (typeof body.active !== "boolean") throw new RequestError(400, "active must be a boolean");
      json(response, 200, await service.set(id, body.active));
    }
    return;
  }
  const stateMatch = /^\/api\/sessions\/([^/]+)\/state$/.exec(url.pathname);
  const permissionsMatch = /^\/api\/sessions\/([^/]+)\/permissions$/.exec(url.pathname);
  if ((method === "GET" || method === "PUT") && permissionsMatch !== null) {
    if (!context.kernel.has(permissionPresetServiceToken)) throw new RequestError(501, "Permission presets are not available in this Profile");
    const id = sessionId(decodeURIComponent(permissionsMatch[1] ?? "")); const service = context.kernel.use(permissionPresetServiceToken);
    if (method === "PUT") await service.set(id, requiredString(await readObject(request), "preset"));
    json(response, 200, await service.select(id)); return;
  }
  if (method === "GET" && stateMatch !== null) {
    const id = sessionId(decodeURIComponent(stateMatch[1] ?? ""));
    const session = await context.kernel.use(sessionStoreToken).read(id); if (session === undefined) throw new RequestError(404, "Session not found");
    const [goal, todos, plan, permissions, agentPreset, subagents, schedules, contextPressure] = await Promise.all([
      context.kernel.has(goalServiceToken) ? context.kernel.use(goalServiceToken).get(id) : undefined,
      context.kernel.has(todoServiceToken) ? context.kernel.use(todoServiceToken).get(id) : undefined,
      context.kernel.has(planModeServiceToken) ? context.kernel.use(planModeServiceToken).get(id) : undefined,
      context.kernel.has(permissionPresetServiceToken) ? context.kernel.use(permissionPresetServiceToken).select(id) : undefined,
      context.kernel.has(agentPresetServiceToken) ? context.kernel.use(agentPresetServiceToken).current(id) : undefined,
      context.kernel.has(subagentServiceToken) ? (() => { const service = context.kernel.use(subagentServiceToken); return service.listDescendants?.(id) ?? service.list(id); })() : [],
      context.kernel.has(scheduleServiceToken) ? context.kernel.use(scheduleServiceToken).list(id) : [],
      sessionContextPressure(session, context.kernel.use(modelServiceToken)),
    ]);
    json(response, 200, {
      goal: goal ?? null,
      todos: todos ?? null,
      plan: plan ?? null,
      permissions: permissions ?? null,
      agentPreset: agentPreset ?? null,
      jobs: context.kernel.has(jobServiceToken) ? context.kernel.use(jobServiceToken).list(id) : [],
      terminals: context.kernel.has(terminalServiceToken) ? context.kernel.use(terminalServiceToken).list(id) : [],
      subagents,
      schedules,
      contextPressure,
    });
    return;
  }
  const scheduleDeleteMatch = /^\/api\/sessions\/([^/]+)\/schedules\/([^/]+)\/delete$/.exec(url.pathname);
  if (method === "POST" && scheduleDeleteMatch !== null) {
    if (!context.kernel.has(scheduleServiceToken)) throw new RequestError(501, "Schedules are not available in this Profile");
    const ownerSession = sessionId(decodeURIComponent(scheduleDeleteMatch[1] ?? ""));
    const scheduleId = decodeURIComponent(scheduleDeleteMatch[2] ?? "");
    const deleted = await context.kernel.use(scheduleServiceToken).delete(ownerSession, scheduleId);
    if (!deleted) throw new RequestError(404, "Schedule not found");
    json(response, 200, { deleted: true });
    return;
  }
  const jobKillMatch = /^\/api\/sessions\/([^/]+)\/jobs\/([^/]+)\/kill$/.exec(url.pathname);
  if (method === "POST" && jobKillMatch !== null) {
    if (!context.kernel.has(jobServiceToken)) throw new RequestError(501, "Jobs are not available in this Profile");
    const ownerSession = sessionId(decodeURIComponent(jobKillMatch[1] ?? ""));
    const jobId = decodeURIComponent(jobKillMatch[2] ?? "");
    json(response, 200, context.kernel.use(jobServiceToken).cancel(jobId, ownerSession, "Cancelled from Web UI"));
    return;
  }
  const terminalKillMatch = /^\/api\/sessions\/([^/]+)\/terminals\/([^/]+)\/kill$/.exec(url.pathname);
  if (method === "POST" && terminalKillMatch !== null) {
    if (!context.kernel.has(terminalServiceToken)) throw new RequestError(501, "Terminals are not available in this Profile");
    const ownerSession = sessionId(decodeURIComponent(terminalKillMatch[1] ?? ""));
    const terminalId = decodeURIComponent(terminalKillMatch[2] ?? "");
    json(response, 200, context.kernel.use(terminalServiceToken).close(terminalId, ownerSession));
    return;
  }
  const subagentAbortMatch = /^\/api\/sessions\/([^/]+)\/subagents\/([^/]+)\/abort$/.exec(url.pathname);
  if (method === "POST" && subagentAbortMatch !== null) {
    if (!context.kernel.has(subagentServiceToken)) throw new RequestError(501, "Subagents are not available in this Profile");
    const parentSessionId = sessionId(decodeURIComponent(subagentAbortMatch[1] ?? ""));
    const childSessionId = sessionId(decodeURIComponent(subagentAbortMatch[2] ?? ""));
    const subagents = context.kernel.use(subagentServiceToken);
    const aborted = await (subagents.interrupt?.(parentSessionId, childSessionId, new Error("Aborted from Web UI"))
      ?? subagents.abort(parentSessionId, childSessionId, new Error("Aborted from Web UI")));
    if (!aborted) throw new RequestError(404, "Subagent not found or no longer running");
    json(response, 200, { aborted: true });
    return;
  }
  if (method === "GET" && url.pathname === "/api/approvals") {
    json(response, 200, context.approvalService.list());
    return;
  }
  if (method === "GET" && url.pathname === "/api/questions") {
    json(response, 200, context.questionAnswerer.list());
    return;
  }
  const questionMatch = /^\/api\/questions\/([^/]+)$/.exec(url.pathname);
  if (method === "POST" && questionMatch !== null) {
    const body = await readObject(request);
    if (!Array.isArray(body.answers)) throw new RequestError(400, "answers must be an array");
    const answers = body.answers.map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) throw new RequestError(400, "each answer must be an object");
      const value = item as Record<string, unknown>;
      if (typeof value.id !== "string" || !Array.isArray(value.selected) || value.selected.some((x) => typeof x !== "string")) throw new RequestError(400, "each answer requires id and selected strings");
      if (value.custom !== undefined && typeof value.custom !== "string") throw new RequestError(400, "answer custom must be a string");
      return { id: value.id, selected: value.selected as string[], ...(value.custom === undefined ? {} : { custom: value.custom }) };
    });
    const decided = context.questionAnswerer.decide(decodeURIComponent(questionMatch[1] ?? ""), { answers });
    if (!decided) throw new RequestError(404, "Question request not found");
    json(response, 200, { decided: true });
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
  if (method === "GET" && credentialMatch !== null) {
    const provider = decodeURIComponent(credentialMatch[1] ?? "");
    const known = (await context.kernel.use(modelServiceToken).list()).some((model) => model.provider === provider);
    if (!known) throw new RequestError(400, `Unsupported provider: ${provider}`);
    const reference = credentialVariable(provider);
    const credentials = context.kernel.has(credentialServiceToken) ? context.kernel.use(credentialServiceToken) : undefined;
    const described = await credentials?.describeRef?.(reference);
    json(response, 200, described ?? {
      configured: typeof context.credentialEnvironment[reference] === "string" && context.credentialEnvironment[reference]!.length > 0,
      writable: true,
      source: "process",
    });
    return;
  }
  if (method === "PUT" && credentialMatch !== null) {
    const provider = decodeURIComponent(credentialMatch[1] ?? "");
    const known = (await context.kernel.use(modelServiceToken).list())
      .some((model) => model.provider === provider);
    if (!known) throw new RequestError(400, `Unsupported provider: ${provider}`);
    const body = await readObject(request);
    if (typeof body.apiKey !== "string") throw new RequestError(400, "apiKey must be a string");
    const variable = credentialVariable(provider);
    const value = body.apiKey.trim();
    const credentials = context.kernel.has(credentialServiceToken) ? context.kernel.use(credentialServiceToken) : undefined;
    if (credentials?.setRef !== undefined && credentials.unsetRef !== undefined) {
      if (value.length === 0) await credentials.unsetRef(variable);
      else await credentials.setRef(variable, value);
    } else context.credentialEnvironment[variable] = value || undefined;
    json(response, 200, { configured: value.length > 0 });
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
  const runMessageMatch = /^\/api\/runs\/([^/]+)\/messages$/.exec(url.pathname);
  if (method === "POST" && runMessageMatch !== null) {
    const run = context.runs.get(decodeURIComponent(runMessageMatch[1] ?? ""));
    if (run === undefined) throw new RequestError(404, "Run not found or no longer active");
    const body = await readObject(request);
    const attachments = attachmentReferences(body.attachments); const prompt = messagePrompt(body, attachments);
    await assertAttachmentsAvailable(context, attachments);
    const mode = optionalString(body, "mode") ?? "steer";
    const requestId = optionalString(body, "requestId");
    const message = { id: messageId(randomUUID()), role: "user" as const, content: [...(prompt === "" ? [] : [text(prompt)]), ...attachments], ...(requestId === undefined ? {} : { source: { kind: "user-rpc" as const, rpcId: requestId } }) };
    if (mode !== "steer" && mode !== "followUp") throw new RequestError(400, "mode must be steer or followUp");
    const runtimeContent = await runtimePromptContent(context, message.content);
    const runtimeMessage = runtimeContent === message.content ? message : { ...message, content: runtimeContent };
    if (mode === "steer") run.steer(message, runtimeMessage);
    else run.followUp(message, runtimeMessage);
    json(response, 202, { queued: true, mode });
    return;
  }
  if (method === "GET") {
    const pluginAsset = /^\/plugins\/([^/]+)\/client\.js$/.exec(url.pathname);
    if (pluginAsset !== null) {
      const name = decodeURIComponent(pluginAsset[1] ?? "");
      const entry = (await context.manager.list()).find((candidate) => candidate.name === name);
      if (entry?.clientEntry === undefined) {
        json(response, 404, { error: "Client plugin not found" });
        return;
      }
      const data = await readFile(entry.clientEntry);
      await sendCompressible(request, response, data, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      }, true);
      return;
    }
    const asset = staticAsset(url.pathname);
    if (asset !== undefined) {
      const data = await readFile(asset.absolute === true ? asset.file : join(PUBLIC_ROOT, asset.file));
      await sendCompressible(request, response, data, {
        "content-type": asset.type,
        "cache-control": "no-cache",
      }, true);
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
  await context.workspaces?.create(cwd);
  await context.dshWorkspaceRegistry?.refresh();
  const selectedSession = optionalString(body, "sessionId");
  const storedSelection = selectedSession === undefined ? undefined : modelSelection(await context.kernel.use(sessionStoreToken).read(sessionId(selectedSession)));
  const provider = optionalString(body, "provider") ?? storedSelection?.provider;
  const model = optionalString(body, "model") ?? storedSelection?.model;
  if (provider === undefined || model === undefined) throw new RequestError(400, "provider and model are required when the Session has no saved model selection");
  const attachments = attachmentReferences(body.attachments);
  const prompt = messagePrompt(body, attachments);
  await assertAttachmentsAvailable(context, attachments);
  const reasoning = optionalReasoning(body.reasoning ?? storedSelection?.reasoningEffort);
  const agentPreset = optionalString(body, "agentPreset");
  const controller = new AbortController();
  const durableContent: readonly ContentBlock[] = [...(prompt === "" ? [] : [text(prompt)]), ...attachments];
  const targetSession = selectedSession === undefined ? undefined : sessionId(selectedSession);
  const parked = targetSession === undefined ? [] : context.dshControl.take(targetSession);
  const promptMessageId = messageId(randomUUID());
  const admitted: import("@seal-harness/core").PendingAgentMessage[] = [
    ...parked,
    { id: promptMessageId, placement: "queued", message: { id: promptMessageId, role: "user", content: durableContent } },
  ];
  const first = admitted.shift()!;
  let disconnected = false;
  response.once("close", () => {
    if (!response.writableEnded) { disconnected = true; controller.abort(new Error("Web client disconnected")); }
  });
  const openStream = () => {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(200, securityHeaders({ "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" }));
    response.flushHeaders();
  };
  let execution: AgentExecution;
  try {
    execution = await context.kernel.use(agentServiceToken).prompt({
      cwd: resolve(cwd),
      model: { provider, model },
      prompt: first.message.content,
      promptMessageId: first.id,
      ...(first.message.source === undefined ? {} : { promptSource: first.message.source }),
      ...(targetSession === undefined ? {} : { sessionId: targetSession }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
      signal: controller.signal,
      ...(body.startupProgress === true ? { onCompactionProgress: (event: Parameters<NonNullable<import("@seal-harness/core").AgentPromptRequest["onCompactionProgress"]>>[0]) => {
        if (disconnected || response.destroyed) return;
        openStream(); writeLine(response, { type: "startup_activity", activity: "compaction", ...event });
      } } : {}),
    });
  } catch (error) {
    if (targetSession !== undefined) context.dshControl.restore(targetSession, parked);
    if (response.headersSent) { if (!disconnected) writeLine(response, { type: "error", error: message(error) }); response.end(); return; }
    throw error;
  }
  await context.dshWorkspaceRegistry?.refresh();
  context.runs.set(execution.runId, execution);
  context.dshControl.track(execution);
  for (const item of admitted) {
    const runtimeContent = await runtimePromptContent(context, item.message.content); const runtimeMessage = runtimeContent === item.message.content ? item.message : { ...item.message, content: runtimeContent };
    if (item.placement === "steering") execution.steer(item.message, runtimeMessage); else execution.followUp(item.message, runtimeMessage);
  }
  openStream();
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
  constructor(readonly status: number, message: string, readonly payload?: JsonObject) { super(message); }
}

async function readObject(request: IncomingMessage, maxBytes = 1_048_576): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new RequestError(413, "Request body is too large");
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

function attachmentReferences(value: unknown): AttachmentBlock[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RequestError(400, "attachments must be an array");
  return value.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new RequestError(400, "each attachment must be an object");
    const record = item as Record<string, unknown>; const id = record.id;
    if (typeof id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(id)) throw new RequestError(400, "attachment id must be a sha256 reference");
    if (record.name !== undefined && typeof record.name !== "string") throw new RequestError(400, "attachment name must be a string");
    if (record.mimeType !== undefined && typeof record.mimeType !== "string") throw new RequestError(400, "attachment mimeType must be a string");
    if (record.bytes !== undefined && (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0)) throw new RequestError(400, "attachment bytes must be a non-negative safe integer");
    const width = attachmentDimension(record.width, "attachment width"); const height = attachmentDimension(record.height, "attachment height");
    if ((width === undefined) !== (height === undefined)) throw new RequestError(400, "attachment width and height must be provided together");
    let originalDimensions: { width: number; height: number } | undefined;
    if (record.originalDimensions !== undefined) {
      if (record.originalDimensions === null || typeof record.originalDimensions !== "object" || Array.isArray(record.originalDimensions)) throw new RequestError(400, "attachment originalDimensions must be an object");
      const original = record.originalDimensions as Record<string, unknown>; const originalWidth = attachmentDimension(original.width, "attachment original width"); const originalHeight = attachmentDimension(original.height, "attachment original height");
      if (originalWidth === undefined || originalHeight === undefined) throw new RequestError(400, "attachment originalDimensions must contain width and height");
      originalDimensions = { width: originalWidth, height: originalHeight };
    }
    return { type: "attachment", id, ...(record.name === undefined ? {} : { name: record.name }), ...(record.mimeType === undefined ? {} : { mimeType: record.mimeType }), ...(record.bytes === undefined ? {} : { bytes: record.bytes }), ...(width === undefined ? {} : { width, height: height! }), ...(originalDimensions === undefined ? {} : { originalDimensions }) } as AttachmentBlock;
  });
}

function attachmentDimension(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new RequestError(400, `${label} must be a positive safe integer`);
  return value as number;
}

function sessionAttachmentReference(session: import("@seal-harness/core").SessionSnapshot, attachmentId: string): AttachmentBlock | undefined {
  const inbox = foldSessionInbox(session.events);
  for (const message of [...inbox.nextTurn, ...inbox.nextStep]) {
    const found = message.content.find(block => block.type === "attachment" && block.id === attachmentId);
    if (found?.type === "attachment") return found;
  }
  for (const entry of session.events) {
    if (entry.event.type !== "message.appended") continue;
    const found = entry.event.payload.message.content.find((block) => block.type === "attachment" && block.id === attachmentId);
    if (found?.type === "attachment") return found;
  }
  return undefined;
}

function messagePrompt(body: JsonObject, attachments: readonly AttachmentBlock[]): string {
  const value = body.prompt;
  if (typeof value !== "string") throw new RequestError(400, "prompt must be a string");
  const prompt = value.trim();
  if (prompt === "" && attachments.length === 0) throw new RequestError(400, "prompt or attachments are required");
  return prompt;
}

async function assertAttachmentsAvailable(context: DispatchContext, attachments: readonly AttachmentBlock[]): Promise<void> {
  if (attachments.length === 0) return;
  if (!context.kernel.has(attachmentServiceToken)) throw new RequestError(501, "Attachments are not available in this Profile");
  const store = context.kernel.use(attachmentServiceToken);
  for (const attachment of attachments) if (await store.get(attachment) === undefined) throw new RequestError(404, `Attachment not found: ${attachment.id}`);
}

async function dshAttachmentMetadata(context: DispatchContext, session: import("@seal-harness/core").SessionSnapshot): Promise<ReadonlyMap<string, DshAttachmentMetadata>> {
  const references = new Map<string, AttachmentBlock>();
  for (const entry of session.events) {
    if (entry.event.type !== "message.appended") continue;
    for (const block of entry.event.payload.message.content) if (block.type === "attachment" && !references.has(block.id)) references.set(block.id, block);
  }
  if (references.size === 0 || !context.kernel.has(attachmentServiceToken)) return new Map();
  const store = context.kernel.use(attachmentServiceToken); const metadata = new Map<string, DshAttachmentMetadata>();
  await Promise.all([...references.values()].map(async (reference) => {
    const stored = await store.get(reference);
    if (stored === undefined) return;
    let dimensions = { width: 0, height: 0 };
    if (stored.mimeType.startsWith("image/")) {
      try { dimensions = imageDimensions(stored.data, stored.mimeType); }
      catch { return; }
    }
    metadata.set(reference.id, {
      attachmentId: reference.id,
      mediaType: stored.mimeType,
      bytes: stored.data.byteLength,
      ...dimensions,
      ...((stored.name ?? reference.name) === undefined ? {} : { name: stored.name ?? reference.name }),
      ...(reference.originalDimensions === undefined ? {} : { originalDimensions: reference.originalDimensions }),
    });
  }));
  return metadata;
}

async function remotePromptContent(context: DispatchContext, value: unknown): Promise<ContentBlock[]> {
  if (!Array.isArray(value)) throw new RequestError(400, "content must be an array");
  const attachmentService = context.kernel.has(attachmentServiceToken) ? context.kernel.use(attachmentServiceToken) : undefined;
  const limits = attachmentService?.imageLimits;
  const parsed = value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new RequestError(400, `content[${index}] must be an object`);
    const record = item as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") return { type: "text" as const, text: record.text };
    if (record.type !== "image" || typeof record.mediaType !== "string" || typeof record.data !== "string") throw new RequestError(400, `content[${index}] is not a valid text or image part`);
    if (!(limits?.mediaTypes ?? ["image/png", "image/jpeg", "image/gif", "image/webp"]).includes(record.mediaType)) throw new RequestError(400, `content[${index}] has an unsupported image media type`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(record.data) || record.data.length % 4 !== 0) throw new RequestError(400, `content[${index}] data must be canonical base64`);
    const data = Buffer.from(record.data, "base64"); const maxImageBytes = limits?.maxImageBytes ?? 10 * 1024 * 1024;
    if (data.byteLength > maxImageBytes) throw new RequestError(413, `content[${index}] image exceeds the ${String(maxImageBytes)} byte limit`);
    let dimensions: { width: number; height: number };
    try { dimensions = imageDimensions(data, record.mediaType); }
    catch (error) { throw new RequestError(400, `content[${index}] ${message(error)}`, { code: "session/attachment-invalid", details: { reason: message(error) } }); }
    if (limits !== undefined && dimensions.width * dimensions.height > limits.maxImagePixels) throw new RequestError(413, `content[${index}] image exceeds the pixel limit`);
    if (limits !== undefined && Math.max(dimensions.width, dimensions.height) > limits.maxImageDimension) throw new RequestError(413, `content[${index}] image exceeds the dimension limit`);
    return { type: "image" as const, mediaType: record.mediaType, data, ...(typeof record.name === "string" ? { name: record.name } : {}) };
  });
  const images = parsed.filter((part): part is Extract<typeof part, { type: "image" }> => part.type === "image");
  if (images.length > 0 && attachmentService === undefined) throw new RequestError(501, "Image attachments are not available in this Profile");
  if (limits !== undefined && images.length > limits.maxImagesPerMessage) throw new RequestError(413, `prompt exceeds the ${String(limits.maxImagesPerMessage)} image limit`);
  if (limits !== undefined && images.reduce((total, image) => total + image.data.byteLength, 0) > limits.maxMessageImageBytes) throw new RequestError(413, `prompt images exceed the ${String(limits.maxMessageImageBytes)} byte aggregate limit`);
  const result: ContentBlock[] = [];
  for (const part of parsed) {
    if (part.type === "text") result.push(part);
    else result.push(await attachmentService!.put({ data: part.data, mimeType: part.mediaType, ...(part.name === undefined ? {} : { name: part.name }) }));
  }
  return result;
}

async function runtimePromptContent(context: DispatchContext, content: readonly ContentBlock[]): Promise<readonly ContentBlock[]> {
  if (!content.some((block) => block.type === "attachment")) return content;
  if (!context.kernel.has(attachmentServiceToken)) throw new RequestError(501, "Image attachments are not available in this Profile");
  const store = context.kernel.use(attachmentServiceToken); const resolved: ContentBlock[] = [];
  for (const block of content) {
    if (block.type !== "attachment") { resolved.push(block); continue; }
    const attachment = await store.get(block);
    if (attachment === undefined) throw new RequestError(404, `Attachment data is unavailable: ${block.id}`, { code: "session/attachment-invalid", details: { reason: "attachment data is unavailable" } });
    if (!attachment.mimeType.startsWith("image/")) throw new RequestError(400, `Queued attachment is not an image: ${block.id}`, { code: "session/attachment-invalid", details: { reason: "queued remote attachments must be images" } });
    resolved.push({ type: "image", mimeType: attachment.mimeType, data: Buffer.from(attachment.data).toString("base64") });
  }
  return resolved;
}

async function drainDetachedRun(context: DispatchContext, execution: AgentExecution): Promise<void> {
  try { for await (const _event of execution) { /* drain the runtime event stream */ } await execution.result; }
  catch { /* failure is already persisted by AgentService; the Remote accepted the prompt */ }
  finally { context.runs.delete(execution.runId); }
}

function imageDimensions(data: Uint8Array, mimeType: string): { width: number; height: number } {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength); let width = 0; let height = 0;
  if (mimeType === "image/png" && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
  else if (mimeType === "image/gif" && bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) { width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); }
  else if (mimeType === "image/jpeg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1] ?? 0; if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes.readUInt16BE(offset + 2); if (length < 2 || offset + 2 + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      offset += 2 + length;
    }
  } else if (mimeType === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (kind === "VP8L" && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
  }
  if (width <= 0 || height <= 0) throw new Error(`Stored attachment is not a valid ${mimeType} image`);
  return { width, height };
}

async function validateUploadedImage(data: Uint8Array, declaredType: string, limits: import("@seal-harness/core").ImageAttachmentLimits | undefined): Promise<void> {
  const formats: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  if (!(limits?.mediaTypes ?? Object.values(formats)).includes(declaredType)) throw new RequestError(400, "Unsupported image media type", { code: "session/attachment-invalid", details: { reason: "UNSUPPORTED_IMAGE_TYPE" } });
  try {
    const pipeline = sharp(data, { failOn: "error", limitInputPixels: false });
    const metadata = await pipeline.metadata();
    const detectedType = formats[String(metadata.format)];
    const transposed = metadata.orientation !== undefined && metadata.orientation >= 5;
    const width = transposed ? metadata.height : metadata.width; const height = transposed ? metadata.width : metadata.height;
    if (detectedType !== declaredType) throw new RequestError(400, "Declared image type does not match its bytes", { code: "session/attachment-invalid", details: { reason: "IMAGE_TYPE_MISMATCH" } });
    if (!width || !height) throw new Error("image dimensions are unavailable");
    if (limits !== undefined && width * height > limits.maxImagePixels) throw new RequestError(413, "Image exceeds the decoded-pixel limit", { code: "session/attachment-invalid", details: { reason: "IMAGE_TOO_MANY_PIXELS" } });
    if (limits !== undefined && Math.max(width, height) > limits.maxImageDimension) throw new RequestError(413, "Image exceeds the per-side pixel limit", { code: "session/attachment-invalid", details: { reason: "IMAGE_DIMENSION_TOO_LARGE" } });
    await pipeline.raw().toBuffer();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Unsupported or malformed image data", { code: "session/attachment-invalid", details: { reason: "INVALID_IMAGE" } });
  }
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

function requiredPositiveInteger(object: JsonObject, key: string): number {
  const value = object[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new RequestError(400, `${key} must be a positive safe integer`);
  return value as number;
}

function optionalPositiveInteger(object: JsonObject, key: string): number | undefined {
  return object[key] === undefined ? undefined : requiredPositiveInteger(object, key);
}

function optionalQueryString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null || value === "" ? undefined : value;
}

function optionalReasoning(value: unknown): "off" | "low" | "medium" | "high" | "max" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "off" || value === "low" || value === "medium" || value === "high" || value === "max") return value;
  throw new RequestError(400, "reasoning must be off, low, medium, high, or max");
}

function optionalProviderApi(value: unknown): PiAiProviderApi | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "openai-completions" || value === "openai-responses" || value === "anthropic-messages") {
    return value;
  }
  throw new RequestError(400, "api must be openai-completions, openai-responses, or anthropic-messages");
}

function credentialVariable(provider: string): string {
  return `${provider.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

function clientBatchRevision(entries: readonly import("@seal-harness/plugin-manager").InstalledPlugin[]): string {
  return createHash("sha256").update(JSON.stringify(entries.map((entry) => [entry.name, entry.version, entry.clientInject, entry.clientExternal, entry.clientImmediately]))).digest("hex").slice(0, 24);
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

async function sendCompressible(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  headers: Record<string, string>,
  allowPluginStyles = false,
): Promise<void> {
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:;|,|$)/i.test(request.headers["accept-encoding"] ?? "");
  const compressed = acceptsGzip && body.byteLength >= COMPRESSION_THRESHOLD_BYTES
    ? await gzipResponse(body, { level: 1 })
    : undefined;
  response.writeHead(200, securityHeaders({
    ...headers,
    "content-length": String((compressed ?? body).byteLength),
    vary: "accept-encoding",
    ...(compressed === undefined ? {} : { "content-encoding": "gzip" }),
  }, allowPluginStyles));
  response.end(compressed ?? body);
}

function writeLine(response: ServerResponse, value: unknown): void {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(value)}\n`);
}

function securityHeaders(
  extra: Record<string, string>,
  allowPluginStyles = false,
): Record<string, string> {
  return {
    // index.html contains one immutable import map. Authorize that exact map
    // without allowing arbitrary inline scripts.
    "content-security-policy": `default-src 'self'; img-src 'self' data:; style-src 'self'${allowPluginStyles ? " 'unsafe-inline'" : ""}; script-src 'self' 'sha256-E3SQIfHoNigirzojkfQFiN5doAfxnDW6T4UX/LFlXRc='; connect-src 'self'`,
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

function upgradePath(request: IncomingMessage): string | undefined {
  try { return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname; }
  catch { return undefined; }
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: 400 | 401 | 403 | 404): void {
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Bad Request";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function staticAsset(pathname: string): { file: string; type: string; absolute?: boolean } | undefined {
  if (pathname === "/" || pathname === "/index.html") return { file: "index.html", type: "text/html; charset=utf-8" };
  if (pathname === "/app.js") return { file: "app.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/client-runtime.js") return { file: "client-runtime.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/markdown.js") return { file: "markdown.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/i18n.js") return { file: "i18n.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/transcript-view.js") return { file: "transcript-view.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/layout.js") return { file: "layout.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/conversation-width.js") return { file: "conversation-width.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/context-meter.js") return { file: "context-meter.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/goal-bar.js") return { file: "goal-bar.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/todo-panel.js") return { file: "todo-panel.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/plan-control.js") return { file: "plan-control.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/job-control.js") return { file: "job-control.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/attachment-drop.js") return { file: "attachment-drop.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/attachment-admission.js") return { file: "attachment-admission.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/context-message.js") return { file: "context-message.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/attachment-drafts.js") return { file: "attachment-drafts.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/input-trigger-menu.js") return { file: "input-trigger-menu.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/attachment-rail.js") return { file: "attachment-rail.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/message-images.js") return { file: "message-images.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/turn-navigator.js") return { file: "turn-navigator.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/pending-interaction.js") return { file: "pending-interaction.js", type: "text/javascript; charset=utf-8" };
  // Root client helpers are code-split ES modules. Keep this constrained to a
  // single safe basename while allowing new helpers to ship without a second,
  // easily-forgotten server whitelist edit.
  if (ROOT_CLIENT_MODULES.has(pathname.slice(1))) return { file: pathname.slice(1), type: "text/javascript; charset=utf-8" };
  if (pathname === "/styles.css") return { file: "styles.css", type: "text/css; charset=utf-8" };
  if (pathname === "/sw.js") return { file: "sw.js", type: "text/javascript; charset=utf-8" };
  if (pathname === "/manifest.webmanifest") return { file: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8" };
  if (pathname === "/vendor/katex.mjs") return { file: join(KATEX_ROOT, "katex.mjs"), type: "text/javascript; charset=utf-8", absolute: true };
  if (pathname === "/vendor/katex.css") return { file: join(KATEX_ROOT, "katex.min.css"), type: "text/css; charset=utf-8", absolute: true };
  if (pathname === "/vendor/highlight.mjs") return { file: HIGHLIGHT_MODULE, type: "text/javascript; charset=utf-8", absolute: true };
  if (pathname === "/vendor/highlight.css") return { file: HIGHLIGHT_STYLE, type: "text/css; charset=utf-8", absolute: true };
  if (pathname === "/vendor/react-runtime.mjs") return { file: "vendor/react-runtime.mjs", type: "text/javascript; charset=utf-8" };
  if (pathname === "/vendor/client-runtime.mjs") return { file: "vendor/client-runtime.mjs", type: "text/javascript; charset=utf-8" };
  if (pathname === "/vendor/client-runtime.css") return { file: "vendor/client-runtime.css", type: "text/css; charset=utf-8" };
  const katexFont = /^\/vendor\/fonts\/([A-Za-z0-9_-]+\.(?:woff2|woff|ttf))$/.exec(pathname);
  if (katexFont !== null) return { file: join(KATEX_ROOT, "fonts", katexFont[1] ?? ""), type: katexFont[1]?.endsWith(".woff2") ? "font/woff2" : katexFont[1]?.endsWith(".woff") ? "font/woff" : "font/ttf", absolute: true };
  if (pathname === "/assets/seal-harness-mascot.png") {
    return { file: "assets/seal-harness-mascot.png", type: "image/png" };
  }
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

function sessionSummary(session: import("@seal-harness/core").SessionSnapshot, running = false): { id: import("@seal-harness/core").SessionId; version: number; cwd: string | undefined; updatedAt: string | undefined; preview: string; running: boolean; blank: boolean; parentSessionId?: string; origin?: "subagent" } {
  const metadata = session.events.find((entry) => entry.event.type === "session.created")?.event;
  const creation = metadata?.type === "session.created" ? metadata.payload.metadata : undefined;
  const sealParent = typeof creation?.["sealHarness.parentSessionId"] === "string" ? creation["sealHarness.parentSessionId"] : undefined;
  const parent = sealParent ?? (typeof creation?.parentSession === "string" ? creation.parentSession : undefined);
  const origin = creation?.origin === "subagent" || sealParent !== undefined ? "subagent" as const : undefined;
  const createdAt = session.events.find((entry) => entry.event.type === "session.created")?.timestamp;
  const createdAtMs = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
  const lastPromptAt = sessionLastPromptAt(session);
  const updatedAtMs = Number.isFinite(createdAtMs) ? Math.max(createdAtMs, lastPromptAt ?? 0) : lastPromptAt;
  return { id: session.id, version: session.version, cwd: sessionCwd(session), updatedAt: updatedAtMs == null ? undefined : new Date(updatedAtMs).toISOString(), preview: sessionTitle(session) ?? preview(deriveSessionMessages(session)), running, blank: sessionBlank(session), ...(parent === undefined ? {} : { parentSessionId: parent }), ...(origin === undefined ? {} : { origin }) };
}

function dshQueueItems(messages: readonly import("@seal-harness/core").PendingAgentMessage[]): unknown[] {
  return messages.map((entry) => {
    const rpcId = entry.message.source?.kind === "user-rpc" && typeof entry.message.source.rpcId === "string" ? entry.message.source.rpcId : undefined;
    return {
      id: entry.id,
      placement: entry.placement,
      ...(rpcId === undefined ? {} : { rpcId }),
      message: { id: entry.id, content: entry.message.content.map((block) => block.type === "text" ? block : { ...block, type: `seal/${block.type}` }) },
    };
  });
}

function dshJobs(jobs: readonly import("@seal-harness/core").JobSnapshot[]): unknown[] {
  return jobs.map((job) => ({
    id: job.id, kind: job.kind, label: job.label,
    status: job.status === "cancelled" ? "killed" : job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }));
}

function webDshFeedbackItem(item: import("@seal-harness/core").MessageFeedbackItem): Readonly<Record<string, unknown>> {
  return Object.freeze({ messageId: item.messageId, rating: item.rating === "up" ? "positive" : "negative", ...(item.note === undefined ? {} : { note: item.note }), version: item.version, createdAt: Date.parse(item.createdAt) || 0, updatedAt: Date.parse(item.updatedAt) || 0 });
}

function webDshFeedbackFailure(error: MessageFeedbackError, request: JsonObject, maxNoteBytes: number | undefined): Readonly<Record<string, unknown>> {
  if (error.code === "SESSION_NOT_FOUND") return { ok: false, error: { code: "session-not-found", sessionId: request.sessionId } };
  if (error.code === "TARGET_NOT_FOUND") return { ok: false, error: { code: "target-not-found", sessionId: request.sessionId, messageId: request.messageId } };
  if (error.code === "VERSION_CONFLICT") return { ok: false, error: { code: "version-conflict", current: error.current === null || error.current === undefined ? null : webDshFeedbackItem(error.current) } };
  if (error.code === "NOTE_BLANK") return { ok: false, error: { code: "note-blank" } };
  if (error.code === "NOTE_TOO_LARGE") return { ok: false, error: { code: "note-too-large", maxBytes: maxNoteBytes ?? 0, actualBytes: Buffer.byteLength(typeof request.note === "string" ? request.note : "", "utf8") } };
  throw error;
}

function dshSessionMention(id: string, label: string): string {
  const escaped = label.replace(/[\\\]]/gu, match => `\\${match}`);
  return `@[${escaped}](dsh-session:${Buffer.from(JSON.stringify(id), "utf8").toString("base64url")})`;
}

async function sessionContextPressure(session: import("@seal-harness/core").SessionSnapshot, models: import("@seal-harness/core").ModelService): Promise<{ pressureTokens: number; contextWindow: number } | null> {
  const modelByRun = new Map<string, import("@seal-harness/core").ModelRef>();
  let sample: { runId: string; usage: import("@seal-harness/core").ModelUsage } | undefined;
  for (const entry of session.events) {
    if (entry.event.type === "run.started") modelByRun.set(entry.event.payload.runId, entry.event.payload.model);
    else if (entry.event.type === "turn.completed" && entry.event.payload.usage !== undefined) sample = { runId: entry.event.payload.runId, usage: entry.event.payload.usage };
  }
  if (sample === undefined) return null;
  const model = modelByRun.get(sample.runId); if (model === undefined) return null;
  const info = await models.get(model); if (info === undefined) return null;
  return { pressureTokens: sample.usage.inputTokens + (sample.usage.cacheReadTokens ?? 0) + (sample.usage.cacheWriteTokens ?? 0), contextWindow: info.contextWindow };
}

function dshProjectionBaseline(session: import("@seal-harness/core").SessionSnapshot, imageLimits?: import("@seal-harness/core").ImageAttachmentLimits): unknown {
  const history = dshWireHistory(session); const selection = modelSelectionProjection(session); const metrics = dshSessionMetrics(history.records);
  const title = sessionTitle(session);
  const lastPromptAt = sessionLastPromptAt(session);
  return {
    asOfSeq: history.records.length - 1,
    values: {
      sessionListMetadata: { blank: sessionBlank(session), lastPromptAt },
      ...(title === undefined ? {} : { title }),
      modelSelection: selection,
      sessionStats: metrics.stats,
      ...(metrics.usage === undefined ? {} : { tokenUsage: { uncachedInputTokens: metrics.usage.inputTokens, outputTokens: metrics.usage.outputTokens, cacheReadTokens: metrics.usage.cacheReadTokens, cacheWriteTokens: metrics.usage.cacheWriteTokens } }),
      ...(imageLimits === undefined ? {} : { imageLimits }),
    },
  };
}

function sessionBlank(session: import("@seal-harness/core").SessionSnapshot): boolean {
  return !session.events.some((entry) => entry.event.type === "turn.started" || (entry.event.type === "dsh.imported" && entry.event.payload.type === "turn/start"));
}

function sessionLastPromptAt(session: import("@seal-harness/core").SessionSnapshot): number | null {
  let lastPromptAt: number | null = null;
  for (const entry of session.events) {
    const nativePrompt = entry.event.type === "message.appended" && entry.event.payload.message.role === "user";
    const importedPrompt = entry.event.type === "dsh.imported" && importedHumanPrompt(entry.event.payload.type, entry.event.payload.data);
    if (!nativePrompt && !importedPrompt) continue;
    const parsed = entry.event.type === "dsh.imported" && typeof entry.event.payload.time === "number" ? entry.event.payload.time : Date.parse(entry.timestamp);
    if (Number.isFinite(parsed)) lastPromptAt = parsed;
  }
  return lastPromptAt;
}

function importedHumanPrompt(type: string, data: import("@seal-harness/core").JsonObject): boolean {
  const source = data.source;
  return type === "user/message" && typeof source === "object" && source !== null && !Array.isArray(source) && (source as import("@seal-harness/core").JsonObject).kind === "user";
}

function sessionTitle(session: import("@seal-harness/core").SessionSnapshot): string | undefined {
  let title: string | undefined;
  for (const stored of session.events) {
    if (stored.event.type === "session.created" && typeof stored.event.payload.metadata?.title === "string") title = stored.event.payload.metadata.title;
    else if (stored.event.type === "session.metadata" && typeof stored.event.payload.patch.title === "string") title = stored.event.payload.patch.title;
    else if (stored.event.type === "dsh.imported" && stored.event.payload.type === "session/title" && typeof stored.event.payload.data.title === "string") title = stored.event.payload.data.title;
  }
  return title;
}

function sessionCwd(session: import("@seal-harness/core").SessionSnapshot): string | undefined {
  for (const entry of session.events) {
    if (entry.event.type === "session.created") return entry.event.payload.cwd;
  }
  return undefined;
}

function modelSelection(session: import("@seal-harness/core").SessionSnapshot | undefined): { provider: string; model: string; reasoningEffort?: string } | undefined {
  if (session === undefined) return undefined;
  return modelSelectionProjection(session).next ?? undefined;
}

type DshModelSelection = { provider: string; model: string; reasoningEffort?: string };

function modelSelectionProjection(session: import("@seal-harness/core").SessionSnapshot): { lastUsed: DshModelSelection | null; next: DshModelSelection | null } {
  let lastUsed: DshModelSelection | null = null; let pending: DshModelSelection | null = null;
  for (const entry of session.events) {
    if (entry.event.type === "session.metadata") {
      const value = entry.event.payload.patch["sealHarness.modelSelection"];
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const record = value as Readonly<Record<string, import("@seal-harness/core").JsonValue>>;
      if (typeof record.provider !== "string" || typeof record.model !== "string") continue;
      pending = { provider: record.provider, model: record.model, ...(typeof record.reasoningEffort === "string" ? { reasoningEffort: record.reasoningEffort } : {}) };
      continue;
    }
    if (entry.event.type === "run.started") {
      lastUsed = { ...entry.event.payload.model, ...(entry.event.payload.reasoning === undefined ? {} : { reasoningEffort: entry.event.payload.reasoning }) };
      if (sameModelSelection(pending, lastUsed)) pending = null;
    }
  }
  return { lastUsed, next: pending ?? lastUsed };
}

function sameModelSelection(left: DshModelSelection | null, right: DshModelSelection | null): boolean {
  return left === right || (left !== null && right !== null && left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort);
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

const FETCH_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

async function listenFetchSafe(server: Server, port: number, host: string): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await listen(server, port, host);
    const address = server.address();
    if (port !== 0 || address === null || typeof address === "string" || !FETCH_BLOCKED_PORTS.has(address.port)) return;
    await new Promise<void>((resolvePromise, reject) => server.close(error => error === undefined ? resolvePromise() : reject(error)));
  }
  throw new Error("Unable to allocate a Fetch-compatible ephemeral port after 16 attempts");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
    server.closeAllConnections();
  });
}

function formatHost(host: string): string { return host.includes(":") ? `[${host}]` : host; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function isSessionSearchDisabled(error: unknown): boolean {
  const seen = new Set<unknown>(); let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (/SESSION_QUERY_SEARCH_DISABLED|session search is disabled/i.test(message(current))) return true;
    if (typeof current !== "object") return false;
    if (Reflect.get(current, "code") === "SESSION_QUERY_SEARCH_DISABLED") return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}

function dshRemoteFailure(error: unknown): { readonly code: string; readonly details: object } | undefined {
  if (typeof error !== "object" || error === null || Reflect.get(error, "isDSHRemoteError") !== true) return undefined;
  const code = Reflect.get(error, "code"); const details = Reflect.get(error, "details");
  if (typeof code !== "string" || typeof details !== "object" || details === null || Array.isArray(details)) return undefined;
  return { code, details: details as object };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function requireLocalPluginManagement(context: DispatchContext): void {
  if (!context.localPluginManagement) {
    throw new RequestError(403, "Plugin management is available only on a loopback Web host");
  }
}

function restoreEnvironment(name: "DSH_HOME" | "DSH_PROFILE", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function webErrorStatus(error: unknown): number {
  if (error instanceof RequestError) return error.status;
  if (error instanceof MessageFeedbackError) return error.code === "VERSION_CONFLICT" ? 409 : error.code.endsWith("NOT_FOUND") ? 404 : 400;
  const dsh = dshRemoteFailure(error);
  if (dsh !== undefined) {
    if (dsh.code.endsWith("/not-found")) return 404;
    if (dsh.code.endsWith("/read-only") || dsh.code.endsWith("/locked") || dsh.code.endsWith("/conflict") || dsh.code.endsWith("/rejected")) return 409;
    if (dsh.code === "gateway/bad-request" || dsh.code === "gateway/cancelled") return 400;
  }
  return 500;
}

type WebMessageView = (import("@seal-harness/core").AgentMessage & { messageId?: string; time?: number; messageKind?: "steering"; referenceLabels?: readonly string[]; interrupted?: true; toolError?: { readonly name: string; readonly code: string }; toolMeta?: import("@seal-harness/core").JsonValue; runId?: string; turnId?: string; turnNumber?: number; turnCompleted?: boolean; turnStopReason?: import("@seal-harness/core").ModelStopReason; producedFiles?: readonly string[]; atSeq?: number; turnUsage?: import("@seal-harness/core").ModelUsage; turnDurationMs?: number; turnFirstTokenMs?: number; turnDecodeTokensPerSecond?: number; turnModel?: { provider: string; model: string } }) | CommandMessageView | CompactionMessageView | ModelRetryMessageView | SystemPromptMessageView | TurnErrorMessageView | TurnMaxTokensMessageView | CompletedTurnTailView | UnknownSurfaceMessageView | WorkflowRunMessageView;

function deriveMessageViews(session: import("@seal-harness/core").SessionSnapshot): WebMessageView[] {
  const surfaceNodes = foldSessionSurface(session.events).nodes; const commands = commandMessageViews(session.events); const compactions = compactionMessageViews(session.events); const retries = modelRetryMessageViews(session.events); const prompts = systemPromptMessageViews(session.events); const turnErrors = turnErrorMessageViews(session.events); const maxTokens = turnMaxTokensMessageViews(session.events); const tailSeeds = turnTailMessageViews(session.events); const unknown = unknownSurfaceMessageViews(session.events); const workflows = workflowRunMessageViews(session.events); const nodes = transcriptNodeSequences(session.events); const forkMetadata = messageForkMetadata(session, surfaceNodes); const tails = new Map([...tailSeeds].map(([sequence, tail]) => [sequence, completedTurnTailView(tail, forkMetadata)]));
  const steeringSequences = steeringMessageSequences(session.events);
  const referenceLabels = referenceLabelsByMessageSequence(session.events, surfaceNodes);
  return nodes.map((sequence) => { const tail = tails.get(sequence); const max = maxTokens.get(sequence); return commands.get(sequence) ?? compactions.get(sequence) ?? retries.get(sequence) ?? prompts.get(sequence) ?? turnErrors.get(sequence) ?? (max === undefined ? undefined : tail === undefined ? max : { ...tail, role: "turn-max-tokens" as const }) ?? unknown.get(sequence) ?? workflows.get(sequence) ?? tail ?? messageViewAt(session, sequence, forkMetadata, steeringSequences, referenceLabels); });
}

type CompletedTurnMetadata = { readonly usage?: import("@seal-harness/core").ModelUsage; readonly stopReason?: import("@seal-harness/core").ModelStopReason; readonly producedFiles?: readonly string[]; readonly durationMs?: number; readonly firstTokenMs?: number; readonly decodeTokensPerSecond?: number; readonly model?: { provider: string; model: string } };
type MessageForkMetadata = { readonly completedTurns: ReadonlyMap<string, CompletedTurnMetadata>; readonly closingAssistantSequences: ReadonlySet<number>; readonly atSeqByMessage: ReadonlyMap<number, number>; readonly turnNumbers: ReadonlyMap<string, number> };
type CompletedTurnTailView = TurnTailMessageView & { readonly turnCompleted: true; readonly turnStopReason?: import("@seal-harness/core").ModelStopReason; readonly producedFiles?: readonly string[]; readonly turnUsage?: import("@seal-harness/core").ModelUsage; readonly turnDurationMs?: number; readonly turnFirstTokenMs?: number; readonly turnDecodeTokensPerSecond?: number; readonly turnModel?: { provider: string; model: string } };

function completedTurnTailView(view: TurnTailMessageView, metadata: MessageForkMetadata): CompletedTurnTailView {
  const completed = metadata.completedTurns.get(view.turnId);
  return { ...view, turnCompleted: true, ...(completed?.stopReason === undefined ? {} : { turnStopReason: completed.stopReason }), ...(completed?.producedFiles === undefined ? {} : { producedFiles: completed.producedFiles }), ...(completed?.usage === undefined ? {} : { turnUsage: completed.usage }), ...(completed?.durationMs === undefined ? {} : { turnDurationMs: completed.durationMs }), ...(completed?.firstTokenMs === undefined ? {} : { turnFirstTokenMs: completed.firstTokenMs }), ...(completed?.decodeTokensPerSecond === undefined ? {} : { turnDecodeTokensPerSecond: completed.decodeTokensPerSecond }), ...(completed?.model === undefined ? {} : { turnModel: completed.model }) };
}

function importedAssistantMetadata(message: import("@seal-harness/core").AssistantMessage): { usage?: import("@seal-harness/core").ModelUsage; model?: { provider: string; model: string }; interrupted?: true } {
  const dsh = message.providerData?.dsh;
  if (typeof dsh !== "object" || dsh === null || Array.isArray(dsh)) return {};
  const record = dsh as Record<string, unknown>; const rawUsage = record.usage;
  let usage: import("@seal-harness/core").ModelUsage | undefined;
  if (typeof rawUsage === "object" && rawUsage !== null && !Array.isArray(rawUsage)) {
    const value = rawUsage as Record<string, unknown>; const count = (name: string): number | undefined => Number.isSafeInteger(value[name]) && (value[name] as number) >= 0 ? value[name] as number : undefined;
    const inputTokens = count("inputTokens"); const outputTokens = count("outputTokens"); const totalTokens = count("totalTokens"); const cacheReadTokens = count("cacheReadTokens"); const cacheWriteTokens = count("cacheWriteTokens"); const reasoningTokens = count("reasoningTokens");
    if (inputTokens !== undefined && outputTokens !== undefined) usage = normalizeTurnUsage({ inputTokens, outputTokens, ...(totalTokens === undefined ? {} : { totalTokens }), ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }), ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }), ...(reasoningTokens === undefined ? {} : { reasoningTokens }) });
  }
  const source = record.source; const provider = typeof source === "object" && source !== null && !Array.isArray(source) && typeof (source as Record<string, unknown>).provider === "string" ? (source as Record<string, unknown>).provider as string : undefined; const modelName = typeof source === "object" && source !== null && !Array.isArray(source) && typeof (source as Record<string, unknown>).model === "string" ? (source as Record<string, unknown>).model as string : undefined; const model = provider === undefined || modelName === undefined ? undefined : { provider, model: modelName };
  const attributedUsage = usage === undefined ? undefined : { ...usage, ...(model === undefined ? {} : { routes: [model] }) };
  return { ...(attributedUsage === undefined ? {} : { usage: attributedUsage }), ...(model === undefined ? {} : { model }), ...(record.interrupted === true ? { interrupted: true as const } : {}) };
}

function normalizeTurnUsage(value: import("@seal-harness/core").ModelUsage): import("@seal-harness/core").ModelUsage | undefined {
  const count = (candidate: unknown): candidate is number => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0;
  if (!count(value.inputTokens) || !count(value.outputTokens)) return undefined;
  if (value.cacheReadTokens !== undefined && !count(value.cacheReadTokens)) return undefined;
  if (value.cacheWriteTokens !== undefined && !count(value.cacheWriteTokens)) return undefined;
  if (value.reasoningTokens !== undefined && (!count(value.reasoningTokens) || value.reasoningTokens > value.outputTokens)) return undefined;
  const knownPrompt = value.inputTokens + (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0); if (!Number.isSafeInteger(knownPrompt)) return undefined;
  let totalTokens = value.totalTokens;
  if (totalTokens === undefined) {
    if (value.cacheReadTokens === undefined || value.cacheWriteTokens === undefined || !Number.isSafeInteger(knownPrompt + value.outputTokens)) return undefined;
    totalTokens = knownPrompt + value.outputTokens;
  } else {
    const exactPrompt = totalTokens - value.outputTokens;
    if (!count(totalTokens) || !count(exactPrompt) || exactPrompt < knownPrompt) return undefined;
    if (value.cacheReadTokens !== undefined && value.cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) return undefined;
  }
  const routes = value.routes?.every((route) => route.provider.length > 0 && route.model.length > 0) === true ? value.routes : undefined;
  return { inputTokens: value.inputTokens, outputTokens: value.outputTokens, totalTokens, ...(value.cacheReadTokens === undefined ? {} : { cacheReadTokens: value.cacheReadTokens }), ...(value.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: value.cacheWriteTokens }), ...(value.reasoningTokens === undefined ? {} : { reasoningTokens: value.reasoningTokens }), ...(routes === undefined ? {} : { routes }), ...(typeof value.costUsd === "number" && Number.isFinite(value.costUsd) && value.costUsd >= 0 ? { costUsd: value.costUsd } : {}) };
}

function aggregateImportedUsage(values: readonly import("@seal-harness/core").ModelUsage[]): import("@seal-harness/core").ModelUsage | undefined {
  if (values.length === 0) return undefined;
  const sum = (numbers: readonly number[]): number | undefined => { const total = numbers.reduce((value, number) => value + number, 0); return Number.isSafeInteger(total) ? total : undefined; };
  const inputTokens = sum(values.map((usage) => usage.inputTokens)); const outputTokens = sum(values.map((usage) => usage.outputTokens)); const totalTokens = values.every((usage) => usage.totalTokens !== undefined) ? sum(values.map((usage) => usage.totalTokens!)) : undefined; if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined;
  const cacheReadTokens = values.every((usage) => usage.cacheReadTokens !== undefined) ? sum(values.map((usage) => usage.cacheReadTokens!)) : undefined;
  const cacheWriteTokens = values.every((usage) => usage.cacheWriteTokens !== undefined) ? sum(values.map((usage) => usage.cacheWriteTokens!)) : undefined;
  const reasoningTokens = values.every((usage) => usage.reasoningTokens !== undefined) ? sum(values.map((usage) => usage.reasoningTokens!)) : undefined;
  const routes = values.every((usage) => usage.routes !== undefined) ? [...new Map(values.flatMap((usage) => usage.routes!).map((route) => [`${route.provider}\0${route.model}`, route])).values()] : undefined;
  return { inputTokens, outputTokens, totalTokens, ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }), ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }), ...(reasoningTokens === undefined ? {} : { reasoningTokens }), ...(routes === undefined ? {} : { routes }) };
}

function messageForkMetadata(session: import("@seal-harness/core").SessionSnapshot, surfaceNodes = foldSessionSurface(session.events).nodes): MessageForkMetadata {
  const history = dshWireHistory(session); const wireBySealSequence = new Map<number, number>();
  history.sealSequences.forEach((sealSequence, wireSequence) => wireBySealSequence.set(sealSequence, wireSequence));
  const completedTurns = new Map<string, CompletedTurnMetadata>(); const completionByTurn = new Map<string, number>(); const startedByTurn = new Map<string, number>(); const turnNumbers = new Map<string, number>(); const modelByRun = new Map<string, { provider: string; model: string }>(); const producedByTurn = new Map<string, string[]>(); const importedUsageByTurn = new Map<string, import("@seal-harness/core").ModelUsage[]>(); const incompleteImportedUsage = new Set<string>(); const importedModelByTurn = new Map<string, { provider: string; model: string }>();
  for (const entry of session.events) {
    if (entry.event.type === "run.started") modelByRun.set(entry.event.payload.runId, entry.event.payload.model);
    else if (entry.event.type === "turn.started") { startedByTurn.set(entry.event.payload.turnId, Date.parse(entry.timestamp)); if (!turnNumbers.has(entry.event.payload.turnId)) turnNumbers.set(entry.event.payload.turnId, turnNumbers.size); }
    else if (entry.event.type === "dsh.imported" && entry.event.payload.type === "turn/start" && Number.isSafeInteger(entry.event.payload.data.turn)) {
      const turn = entry.event.payload.data.turn as number; const importedTurnId = `dsh-turn-${turn}`;
      startedByTurn.set(importedTurnId, entry.event.payload.time ?? Date.parse(entry.timestamp)); if (!turnNumbers.has(importedTurnId)) turnNumbers.set(importedTurnId, Math.max(0, turn - 1));
    }
    else if (entry.event.type === "message.appended" && entry.event.payload.message.role === "assistant" && typeof entry.event.payload.turnId === "string" && entry.event.payload.turnId.startsWith("dsh-turn-")) {
      const turnId = entry.event.payload.turnId; const metadata = importedAssistantMetadata(entry.event.payload.message);
      if (metadata.usage === undefined) incompleteImportedUsage.add(turnId); else { const usages = importedUsageByTurn.get(turnId) ?? []; usages.push(metadata.usage); importedUsageByTurn.set(turnId, usages); }
      if (metadata.model !== undefined) importedModelByTurn.set(turnId, metadata.model);
    }
    else if (entry.event.type === "tool.completed") {
      const path = producedFilePath(entry.event.payload.name, entry.event.payload.result);
      if (path !== undefined) { const paths = producedByTurn.get(entry.event.payload.turnId) ?? []; if (!paths.includes(path)) paths.push(path); producedByTurn.set(entry.event.payload.turnId, paths); }
    }
  }
  for (const entry of session.events) {
    if (entry.event.type === "dsh.imported" && entry.event.payload.type === "turn/end" && Number.isSafeInteger(entry.event.payload.data.turn)) {
      const turnId = `dsh-turn-${entry.event.payload.data.turn as number}`; const startedAt = startedByTurn.get(turnId); const completedAt = entry.event.payload.time ?? Date.parse(entry.timestamp);
      const reason = entry.event.payload.data.reason; const kind = typeof reason === "object" && reason !== null && !Array.isArray(reason) && typeof (reason as Record<string, unknown>).kind === "string" ? (reason as Record<string, unknown>).kind : reason;
      const stopReason: import("@seal-harness/core").ModelStopReason = kind === "max-tokens" ? "length" : kind === "error" ? "error" : kind === "aborted" || kind === "interrupted" ? "aborted" : "stop";
      const usage = incompleteImportedUsage.has(turnId) ? undefined : aggregateImportedUsage(importedUsageByTurn.get(turnId) ?? []);
      completedTurns.set(turnId, { stopReason, ...(usage === undefined ? {} : { usage }), ...(importedModelByTurn.get(turnId) === undefined ? {} : { model: importedModelByTurn.get(turnId)! }), ...(startedAt === undefined || !Number.isFinite(startedAt) || !Number.isFinite(completedAt) ? {} : { durationMs: Math.max(0, completedAt - startedAt) }) });
      const wireSequence = wireBySealSequence.get(entry.sequence); if (wireSequence !== undefined) completionByTurn.set(turnId, wireSequence);
      continue;
    }
    if (entry.event.type !== "turn.completed") continue;
    const startedAt = startedByTurn.get(entry.event.payload.turnId); const completedAt = Date.parse(entry.timestamp);
    const firstTokenAt = entry.event.payload.timing?.firstTokenAt; const firstTokenMs = startedAt === undefined || firstTokenAt === undefined ? undefined : Math.max(0, firstTokenAt - startedAt); const decodeMs = firstTokenAt === undefined || !Number.isFinite(completedAt) ? undefined : Math.max(0, completedAt - firstTokenAt); const usage = entry.event.payload.usage === undefined ? undefined : normalizeTurnUsage(entry.event.payload.usage); const outputTokens = usage?.outputTokens;
    completedTurns.set(entry.event.payload.turnId, {
      ...(usage === undefined ? {} : { usage }),
      ...(entry.event.payload.stopReason === undefined ? {} : { stopReason: entry.event.payload.stopReason }),
      ...(producedByTurn.get(entry.event.payload.turnId)?.length ? { producedFiles: producedByTurn.get(entry.event.payload.turnId)! } : {}),
      ...(startedAt === undefined || !Number.isFinite(startedAt) || !Number.isFinite(completedAt) ? {} : { durationMs: Math.max(0, completedAt - startedAt) }),
      ...(firstTokenMs === undefined ? {} : { firstTokenMs }),
      ...(decodeMs === undefined || decodeMs <= 0 || outputTokens === undefined ? {} : { decodeTokensPerSecond: outputTokens * 1000 / decodeMs }),
      ...(modelByRun.get(entry.event.payload.runId) === undefined ? {} : { model: modelByRun.get(entry.event.payload.runId)! }),
    });
    const wireSequence = wireBySealSequence.get(entry.sequence);
    if (wireSequence !== undefined) completionByTurn.set(entry.event.payload.turnId, wireSequence);
  }
  const lastAssistantByTurn = new Map<string, number>(); const latestTranscriptByTurn = new Map<string, number>();
  for (const sequence of surfaceNodes) {
    const event = session.events[sequence - 1]?.event;
    if (event?.type !== "message.appended" || event.payload.turnId === undefined) continue;
    if (event.payload.message.role === "assistant") { lastAssistantByTurn.set(event.payload.turnId, sequence); latestTranscriptByTurn.set(event.payload.turnId, sequence); }
    else if (event.payload.message.role === "tool") latestTranscriptByTurn.set(event.payload.turnId, sequence);
  }
  const atSeqByMessage = new Map<number, number>();
  for (const [turnId, sequence] of lastAssistantByTurn) {
    const atSeq = completionByTurn.get(turnId); const completed = completedTurns.get(turnId);
    if (atSeq !== undefined && latestTranscriptByTurn.get(turnId) === sequence && completed?.stopReason !== "error") atSeqByMessage.set(sequence, atSeq);
  }
  return { completedTurns, closingAssistantSequences: new Set(lastAssistantByTurn.values()), atSeqByMessage, turnNumbers };
}

function turnOutline(session: import("@seal-harness/core").SessionSnapshot, surfaceNodes: readonly number[], metadata: MessageForkMetadata): readonly { turn: number; turnId: string; prompt: string; response: string }[] {
  const items = new Map<string, { turn: number; turnId: string; prompt: string; response: string }>();
  for (const sequence of surfaceNodes) {
    const event = session.events[sequence - 1]?.event;
    if (event?.type !== "message.appended" || event.payload.turnId === undefined) continue;
    const turnId = event.payload.turnId; const turn = metadata.turnNumbers.get(turnId);
    if (turn === undefined) continue;
    const item = items.get(turnId) ?? { turn, turnId, prompt: "", response: "" };
    const text = event.payload.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n").replace(/\s+/gu, " ").trim().slice(0, 160);
    if (event.payload.message.role === "user" && item.prompt === "") item.prompt = text;
    if (event.payload.message.role === "assistant" && text !== "") item.response = text;
    items.set(turnId, item);
  }
  return [...items.values()].sort((left, right) => left.turn - right.turn);
}

function messageViewAt(session: import("@seal-harness/core").SessionSnapshot, sequence: number, forkMetadata: MessageForkMetadata = messageForkMetadata(session), steeringSequences: ReadonlySet<number> = steeringMessageSequences(session.events), referenceLabels: ReadonlyMap<number, readonly string[]> = referenceLabelsByMessageSequence(session.events, foldSessionSurface(session.events).nodes)): WebMessageView {
  const storedEvent = session.events[sequence - 1]; const event = storedEvent?.event;
  if (event?.type === "message.appended") {
    const { runId, turnId } = event.payload;
    const atSeq = forkMetadata.atSeqByMessage.get(sequence); const completed = turnId === undefined || !forkMetadata.closingAssistantSequences.has(sequence) ? undefined : forkMetadata.completedTurns.get(turnId);
    const turn = turnId === undefined ? {} : { turnId, ...(forkMetadata.turnNumbers.get(turnId) === undefined ? {} : { turnNumber: forkMetadata.turnNumbers.get(turnId) }), turnCompleted: completed !== undefined, ...(atSeq === undefined ? {} : { atSeq }), ...(completed?.stopReason === undefined ? {} : { turnStopReason: completed.stopReason }), ...(completed?.producedFiles === undefined ? {} : { producedFiles: completed.producedFiles }), ...(completed?.usage === undefined ? {} : { turnUsage: completed.usage }), ...(completed?.durationMs === undefined ? {} : { turnDurationMs: completed.durationMs }), ...(completed?.firstTokenMs === undefined ? {} : { turnFirstTokenMs: completed.firstTokenMs }), ...(completed?.decodeTokensPerSecond === undefined ? {} : { turnDecodeTokensPerSecond: completed.decodeTokensPerSecond }), ...(completed?.model === undefined ? {} : { turnModel: completed.model }) };
    const message = event.payload.message;
    const importedTool = message.role === "tool" && typeof message.providerData?.dsh === "object" && message.providerData.dsh !== null && !Array.isArray(message.providerData.dsh) ? message.providerData.dsh as Record<string, unknown> : undefined;
    const details = message.role === "tool" && importedTool === undefined && message.providerData === undefined ? persistedToolDetails(session, sequence, message.callId) : undefined; const toolMeta = importedTool?.meta as import("@seal-harness/core").JsonValue | undefined;
    const importedError = importedTool?.error; const toolErrorName = typeof importedError === "object" && importedError !== null && !Array.isArray(importedError) && typeof (importedError as Record<string, unknown>).name === "string" ? (importedError as Record<string, unknown>).name as string : undefined; const toolErrorCode = typeof importedError === "object" && importedError !== null && !Array.isArray(importedError) && typeof (importedError as Record<string, unknown>).code === "string" ? (importedError as Record<string, unknown>).code as string : undefined; const toolError = toolErrorName === undefined || toolErrorCode === undefined ? undefined : { name: toolErrorName, code: toolErrorCode };
    const interrupted = message.role === "assistant" && importedAssistantMetadata(message).interrupted === true;
    const parsedTime = storedEvent === undefined ? Number.NaN : Date.parse(storedEvent.timestamp); const time = Number.isFinite(parsedTime) ? parsedTime : undefined;
    return { ...message, ...(time === undefined ? {} : { time }), ...(steeringSequences.has(sequence) ? { messageKind: "steering" as const } : {}), ...(referenceLabels.get(sequence) === undefined ? {} : { referenceLabels: referenceLabels.get(sequence)! }), ...(details === undefined ? {} : { providerData: details }), ...(toolMeta === undefined ? {} : { toolMeta }), ...(toolError === undefined ? {} : { toolError }), ...(interrupted ? { interrupted: true as const } : {}), messageId: event.payload.messageId, ...(runId === undefined ? {} : { runId }), ...turn };
  }
  if (event?.type === "context.compacted") return event.payload.summaryMessage;
  throw new Error(`Session surface references non-message event at sequence ${sequence}`);
}

function persistedToolDetails(session: import("@seal-harness/core").SessionSnapshot, throughSequence: number, callId: string): import("@seal-harness/core").JsonObject | undefined {
  for (let index = Math.min(throughSequence - 1, session.events.length - 1); index >= 0; index -= 1) {
    const event = session.events[index]?.event;
    if (event?.type !== "tool.completed" || event.payload.callId !== callId) continue;
    const details = event.payload.result.details;
    return typeof details === "object" && details !== null && !Array.isArray(details) ? details as import("@seal-harness/core").JsonObject : undefined;
  }
  return undefined;
}

function producedFilePath(name: string, result: import("@seal-harness/core").ToolResult): string | undefined {
  if (result.isError === true || !["write_file", "replace_text", "write", "edit", "apply_patch"].includes(name)) return undefined;
  if (typeof result.details !== "object" || result.details === null || Array.isArray(result.details)) return undefined;
  const details = result.details as Record<string, unknown>; const value = details.path ?? details.file_path ?? details.filePath;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedQueryInteger(url: URL, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = url.searchParams.get(name); if (raw === null) return fallback;
  const value = Number(raw); if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RequestError(400, `${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
