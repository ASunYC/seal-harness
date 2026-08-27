import {
  Context as CordisContext,
  Service as CordisService,
  type Fiber as CordisFiber,
  type Plugin as CordisPlugin,
} from "@deepseek-ai/cordis";
import {
  text,
  toolServiceToken,
  type ContentBlock,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type SealHarnessEvents,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
  type ToolRisk,
  type ToolService,
} from "@seal-harness/core";
import { createServiceToken, definePlugin } from "@seal-harness/kernel";

export type DshPlugin = CordisPlugin;

export interface DshPluginModule {
  readonly default?: DshPlugin;
  readonly name?: string;
  readonly inject?: unknown;
  readonly Config?: unknown;
  // `any` is intentional: imported DSH modules expose their own config type.
  apply?(context: CordisContext, config: any): unknown;
}

export type DshPluginSource = DshPlugin | DshPluginModule;

export interface DshPluginSpec {
  readonly plugin: DshPluginSource;
  readonly config?: unknown;
  readonly enabled?: boolean;
}

export interface DshCompatConfig {
  readonly plugins: readonly DshPluginSpec[];
  /** Additional named Cordis services made available to DSH `inject` declarations. */
  readonly services?: Readonly<Record<string, unknown>>;
  /** Maximum time to wait for initial Cordis plugin loading work to settle. */
  readonly startupTimeoutMs?: number;
  /** Conservative risk assigned to bridged DSH tools unless overridden by name. */
  readonly defaultToolRisk?: ToolRisk;
  readonly toolRisks?: Readonly<Record<string, ToolRisk>>;
}

export interface DshCompatService {
  readonly context: CordisContext;
  readonly fibers: readonly CordisFiber[];
}

export const dshCompatServiceToken = createServiceToken<DshCompatService>(
  "seal-harness.dsh-compat",
);

export class DshCompatRuntime implements DshCompatService {
  readonly context = new CordisContext();
  readonly fibers: CordisFiber[] = [];
  #stopped = false;

  constructor(
    readonly tools: ToolService | undefined,
    readonly config: DshCompatConfig,
  ) {}

  async start(): Promise<void> {
    if (!Array.isArray(this.config.plugins)) {
      throw new TypeError("DSH compatibility config requires a plugins array");
    }
    const startupTimeoutMs = positiveDuration(this.config.startupTimeoutMs ?? 10_000);
    assertToolRisk(this.config.defaultToolRisk ?? "external", "defaultToolRisk");
    for (const [name, risk] of Object.entries(this.config.toolRisks ?? {})) {
      assertToolRisk(risk, `toolRisks.${name}`);
    }
    const services = this.config.services ?? {};
    for (const [name, service] of Object.entries(services)) {
      if (name.trim().length === 0) throw new TypeError("DSH service name must not be empty");
      if (name === "tools" && this.tools !== undefined) {
        throw new Error("DSH service 'tools' is reserved by the Seal Harness tool bridge");
      }
      this.context.provide(name, service);
    }

    if (this.tools !== undefined) {
      new SealToolRuntimeBridge(this.context, this.tools, {
        defaultRisk: this.config.defaultToolRisk ?? "external",
        risks: this.config.toolRisks ?? {},
      });
    }

    try {
      for (const spec of this.config.plugins) {
        if (spec.enabled === false) continue;
        const source = normalizePlugin(spec.plugin);
        this.fibers.push(this.context.plugin(source as CordisPlugin, spec.config));
      }
      await withTimeout(
        Promise.all(this.fibers.map((fiber) => Promise.resolve(fiber))),
        startupTimeoutMs,
        `DSH plugin initialization did not settle within ${startupTimeoutMs}ms`,
      );
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    await this.context.fiber.dispose();
  }
}

export const dshCompatPlugin = definePlugin<DshCompatConfig, SealHarnessEvents>({
  name: "dsh-compat",
  provides: [dshCompatServiceToken],
  optional: [toolServiceToken],
  async setup(context, config) {
    const runtime = new DshCompatRuntime(
      context.has(toolServiceToken) ? context.use(toolServiceToken) : undefined,
      config,
    );
    await runtime.start();
    context.provide(dshCompatServiceToken, runtime);
    return () => runtime.stop();
  },
});

interface DshToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly output: {
    readonly schema: unknown;
    render(argumentsValue: unknown, value: unknown): readonly unknown[];
    presentationMeta?(argumentsValue: unknown, value: unknown): unknown;
  };
  execute(argumentsValue: unknown, context: DshToolRunContext): Promise<unknown>;
  finalizeContent?(
    context: Readonly<DshToolRunContext>,
    result: Readonly<DshToolExecutionResult>,
  ): readonly unknown[] | undefined;
}

interface DshToolRunContext {
  readonly callId: string;
  readonly rootCallId: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly signal: AbortSignal;
  readonly token: symbol;
  deferContext(message: unknown): void;
  concludeTurn(): void;
}

type DshToolExecutionResult =
  | {
      readonly isError: false;
      readonly value: unknown;
      readonly content: readonly ContentBlock[];
      readonly meta?: JsonValue;
      readonly additionalContexts?: readonly unknown[];
      readonly concludesTurn?: true;
    }
  | {
      readonly isError: true;
      readonly error: { readonly message: string; readonly info?: { readonly name: string } };
      readonly content: readonly ContentBlock[];
      readonly additionalContexts?: readonly unknown[];
    };

interface ToolBridgeOptions {
  readonly defaultRisk: ToolRisk;
  readonly risks: Readonly<Record<string, ToolRisk>>;
}

class SealToolRuntimeBridge extends CordisService {
  constructor(
    context: CordisContext,
    readonly tools: ToolService,
    readonly options: ToolBridgeOptions,
  ) {
    super(context, "tools");
  }

  register(definition: unknown): () => void {
    const dshTool = assertDshTool(definition);
    return this.ctx.effect(() => this.tools.register(adaptDshTool(dshTool, this.options)));
  }
}

function adaptDshTool(
  definition: DshToolDefinition,
  options: ToolBridgeOptions,
): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.parameters,
    classify(input) {
      return {
        kind: "tool",
        toolName: definition.name,
        risk: options.risks[definition.name] ?? options.defaultRisk,
        summary: `Run DSH tool ${definition.name}`,
      };
    },
    async execute(input, context) {
      return executeDshTool(definition, input, context);
    },
  };
}

async function executeDshTool(
  definition: DshToolDefinition,
  input: JsonObject,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const deferredContexts: unknown[] = [];
  let concludesTurn = false;
  const execution: DshToolRunContext = Object.freeze({
    callId: context.callId,
    rootCallId: context.callId,
    name: definition.name,
    arguments: input,
    signal: context.signal,
    token: Symbol(`dsh-tool:${definition.name}:${context.callId}`),
    deferContext(message: unknown) {
      deferredContexts.push(message);
    },
    concludeTurn() {
      concludesTurn = true;
    },
  });

  try {
    const value = await definition.execute(input, execution);
    let content = normalizeContent(definition.output.render(input, value));
    const result: DshToolExecutionResult = {
      isError: false,
      value,
      content,
      ...(definition.output.presentationMeta === undefined
        ? {}
        : { meta: toJsonValue(definition.output.presentationMeta(input, value)) }),
      ...(deferredContexts.length === 0 ? {} : { additionalContexts: deferredContexts }),
      ...(concludesTurn ? { concludesTurn: true as const } : {}),
    };
    const replacement = definition.finalizeContent?.(execution, result);
    if (replacement !== undefined) content = normalizeContent(replacement);
    return {
      content,
      details: toJsonValue({
        value,
        dsh: { deferredContexts, concludesTurn },
      }),
    };
  } catch (error) {
    let content: ContentBlock[] = [text(errorMessage(error))];
    const result: DshToolExecutionResult = {
      isError: true,
      error: {
        message: errorMessage(error),
        info: { name: error instanceof Error ? error.name : "Error" },
      },
      content,
      ...(deferredContexts.length === 0 ? {} : { additionalContexts: deferredContexts }),
    };
    const replacement = definition.finalizeContent?.(execution, result);
    if (replacement !== undefined) content = normalizeContent(replacement);
    return {
      content,
      isError: true,
      details: toJsonValue({
        error: result.error,
        dsh: { deferredContexts, concludesTurn: false },
      }),
    };
  }
}

function assertDshTool(value: unknown): DshToolDefinition {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("DSH tools.register() requires a tool definition object");
  }
  const candidate = value as Partial<DshToolDefinition>;
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    throw new TypeError("DSH tool name must be a non-empty string");
  }
  if (typeof candidate.description !== "string") {
    throw new TypeError(`DSH tool ${candidate.name} is missing description`);
  }
  if (typeof candidate.parameters !== "object" || candidate.parameters === null) {
    throw new TypeError(`DSH tool ${candidate.name} is missing parameters JSON Schema`);
  }
  if (
    typeof candidate.output !== "object"
    || candidate.output === null
    || typeof candidate.output.render !== "function"
  ) {
    throw new TypeError(`DSH tool ${candidate.name} is missing output.render()`);
  }
  if (typeof candidate.execute !== "function") {
    throw new TypeError(`DSH tool ${candidate.name} is missing execute()`);
  }
  return candidate as DshToolDefinition;
}

function normalizePlugin(source: DshPluginSource): DshPlugin {
  if (isCordisPlugin(source)) return source;
  if (typeof source === "object" && source !== null && isCordisPlugin(source.default)) {
    return source.default;
  }
  throw new TypeError("Invalid DSH plugin: expected a function, class, { apply } object, or module namespace");
}

function isCordisPlugin(value: unknown): value is DshPlugin {
  return typeof value === "function"
    || (typeof value === "object" && value !== null && typeof (value as { apply?: unknown }).apply === "function");
}

function normalizeContent(values: readonly unknown[]): ContentBlock[] {
  return values.map((value) => {
    if (typeof value !== "object" || value === null) return text(String(value));
    const block = value as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return text(block.text);
    }
    if (
      block.type === "image"
      && typeof block.data === "string"
      && typeof block.mimeType === "string"
    ) {
      return { type: "image", data: block.data, mimeType: block.mimeType };
    }
    return text(`[DSH content ${String(block.type ?? "unknown")}] ${safeJson(value)}`);
  });
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("startupTimeoutMs must be a positive finite number");
  }
  return value;
}

function assertToolRisk(value: unknown, field: string): asserts value is ToolRisk {
  if (!(value === "read" || value === "workspace-write" || value === "external" || value === "dangerous")) {
    throw new TypeError(`${field} must be read, workspace-write, external, or dangerous`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
