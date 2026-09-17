import {
  createAgentSession, ModelRuntime,
  type AgentSession, type ResourceLoader, type SessionManager, type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { lazyStream, type CredentialStore } from "@earendil-works/pi-ai";
import type { ModelService, RuntimeStartRequest } from "@seal-harness/core";
import { createModelBridge, createPiModel } from "./model-bridge.js";

/**
 * The SDK must not discover a second credential store in ~/.pi. Credentials are
 * resolved by the existing Seal model transport; this private SDK facade cannot
 * login, logout, or persist secrets. It is not a UI auth-status service.
 */
const transportCredentials: CredentialStore = {
  async read() { return undefined; },
  async list() { return []; },
  async modify() { throw new Error("Manage model credentials through Seal settings"); },
  async delete() { throw new Error("Manage model credentials through Seal settings"); },
};

export interface SealCodingSessionOptions {
  readonly request: Pick<RuntimeStartRequest, "cwd" | "model" | "reasoning" | "maxTokens">;
  readonly modelService: ModelService;
  /** Explicit ownership: callers choose Seal's storage, never SDK global defaults. */
  readonly agentDir: string;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly resourceLoader: ResourceLoader;
  readonly tools: ToolDefinition[];
  readonly requestConfig?: () => import("@seal-harness/core").RuntimeModelRequestConfig;
  readonly signal?: AbortSignal;
}

/** Create the upstream session, adapting model I/O only (no execution/retry loop). */
export async function createSealCodingSession(options: SealCodingSessionOptions): Promise<AgentSession> {
  const { request, modelService } = options;
  const model = await createPiModel(modelService, request.model.provider, request.model.model);
  const bridge = createModelBridge(modelService);
  const modelRuntime = await ModelRuntime.create({
    credentials: transportCredentials, modelsPath: null, refreshOnCreate: false,
  });
  const stream: import("@earendil-works/pi-ai").Provider["streamSimple"] = (activeModel, context, streamOptions) =>
    lazyStream(activeModel, async () => {
      options.signal?.throwIfAborted();
      const config = options.requestConfig?.() ?? request;
      const selected = config.model.provider === activeModel.provider && config.model.model === activeModel.id
        ? activeModel : await createPiModel(modelService, config.model.provider, config.model.model);
      return bridge(selected, context, { ...streamOptions,
        ...(options.signal === undefined ? {} : { signal: streamOptions?.signal ? AbortSignal.any([options.signal, streamOptions.signal]) : options.signal }),
        ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
        ...(config.reasoning === undefined || config.reasoning === "off" ? {} : { reasoning: config.reasoning }) });
    });
  modelRuntime.registerNativeProvider({
    id: model.provider, name: model.provider,
    // Authentication is performed inside modelService.stream, not bypassed.
    // The keyless ambient result only grants access to this in-process adapter.
    auth: { apiKey: { name: "Seal model transport", async resolve({ signal }) {
      signal.throwIfAborted();
      return { type: "api_key", source: "Seal model transport", auth: {} };
    } } },
    getModels: () => [model],
    stream: (activeModel, context, streamOptions) => stream(activeModel, context, {
      ...(streamOptions?.signal === undefined ? {} : { signal: streamOptions.signal }),
      ...(streamOptions?.temperature === undefined ? {} : { temperature: streamOptions.temperature }),
      ...(streamOptions?.maxTokens === undefined ? {} : { maxTokens: streamOptions.maxTokens }),
    }),
    streamSimple: stream,
  });
  const { session } = await createAgentSession({
    cwd: request.cwd, agentDir: options.agentDir, model, modelRuntime,
    thinkingLevel: request.reasoning ?? "off",
    sessionManager: options.sessionManager, settingsManager: options.settingsManager,
    resourceLoader: options.resourceLoader,
    tools: options.tools.map(tool => tool.name), customTools: options.tools,
  });
  return session;
}

/** Register an existing Seal transport model, then use SDK's public model switch. */
export async function selectSealCodingModel(session: AgentSession, models: ModelService, config: import("@seal-harness/core").RuntimeModelRequestConfig): Promise<void> {
  const model = await createPiModel(models, config.model.provider, config.model.model);
  if (session.model?.provider !== model.provider || session.model.id !== model.id) {
    const transport = session.model && session.modelRuntime.getProvider(session.model.provider);
    if (!transport) throw new Error("Seal coding session transport is unavailable");
    const known = session.modelRuntime.getProvider(model.provider)?.getModels() ?? [];
    session.modelRuntime.registerNativeProvider({ ...transport, id: model.provider, name: model.provider,
      getModels: () => [...known.filter(entry => entry.id !== model.id), model] });
    await session.setModel(model);
  }
  session.setThinkingLevel(config.reasoning ?? "off");
}
