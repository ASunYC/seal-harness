import {
  ApprovalUnavailableError,
  approvalServiceToken,
  DuplicateToolError,
  InvalidToolInputError,
  policyServiceToken,
  spillStoreToken,
  settingsServiceToken,
  ToolDeniedError,
  ToolNotFoundError,
  toolServiceToken,
  type ApprovalService,
  type ContentBlock,
  type ModelToolDefinition,
  type SealHarnessEvents,
  type PolicyService,
  type ToolDefinition,
  type ToolExecutionRequest,
  type ToolGuard,
  type ToolResult,
  type ToolRestriction,
  type ToolRegistrationOptions,
  type ToolService,
  type SpillStore,
} from "@seal-harness/core";
import { definePlugin, type PluginContext } from "@seal-harness/kernel";
import { Type } from "typebox";
import { Check } from "typebox/value";

export interface ToolsCoreConfig {
  readonly maxResultBytes?: number;
}

export class PolicyToolService implements ToolService {
  readonly #tools = new Map<string, Array<{ tool: ToolDefinition; ownerSession?: import("@seal-harness/core").SessionId }>>();
  readonly #restrictions = new Map<import("@seal-harness/core").SessionId, ToolRestriction[]>();
  readonly #guards: Array<{ guard: ToolGuard; ownerSession?: import("@seal-harness/core").SessionId }> = [];
  readonly #modelFilters: Array<(definition: ModelToolDefinition, sessionId?: import("@seal-harness/core").SessionId) => boolean> = [];

  constructor(
    readonly policy: PolicyService,
    readonly approval: ApprovalService | undefined,
    readonly emit: PluginContext<SealHarnessEvents>["emit"],
    readonly maxResultBytes: number | (() => number) = 256 * 1024,
    readonly spillStore?: SpillStore,
  ) {}

  register(tool: ToolDefinition, options: ToolRegistrationOptions = {}): () => void {
    if (tool.timeoutMs !== undefined && (!Number.isFinite(tool.timeoutMs) || tool.timeoutMs <= 0)) throw new TypeError(`tool ${tool.name} timeoutMs must be a positive finite number`);
    const entries = this.#tools.get(tool.name) ?? [];
    if (entries.some((entry) => entry.ownerSession === options.ownerSession)) {
      throw new DuplicateToolError(tool.name);
    }
    const entry = { tool, ...(options.ownerSession === undefined ? {} : { ownerSession: options.ownerSession }) };
    entries.push(entry);
    this.#tools.set(tool.name, entries);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.#tools.get(tool.name);
      if (current === undefined) return;
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#tools.delete(tool.name);
    };
  }

  restrict(filter: ToolRestriction, options: { readonly ownerSession: import("@seal-harness/core").SessionId }): () => void {
    if (filter.allow === undefined && filter.deny === undefined) throw new TypeError("tool restriction requires allow and/or deny");
    const known = new Set([...this.#tools.entries()].filter(([, entries]) => entries.some((entry) => entry.ownerSession === undefined)).map(([name]) => name));
    const named = [...filter.allow ?? [], ...filter.deny ?? []];
    const unknown = named.filter((name) => !known.has(name));
    if (unknown.length > 0) throw new Error(`tool restriction names unknown global tools: ${unknown.join(", ")}`);
    const normalized = Object.freeze({ ...(filter.allow === undefined ? {} : { allow: [...new Set(filter.allow)] }), ...(filter.deny === undefined ? {} : { deny: [...new Set(filter.deny)] }) });
    const entries = this.#restrictions.get(options.ownerSession) ?? []; entries.push(normalized); this.#restrictions.set(options.ownerSession, entries);
    let active = true; return () => { if (!active) return; active = false; const index = entries.indexOf(normalized); if (index >= 0) entries.splice(index, 1); if (entries.length === 0) this.#restrictions.delete(options.ownerSession); };
  }

  guard(guard: ToolGuard, options: ToolRegistrationOptions = {}): () => void {
    if (typeof guard !== "function") throw new TypeError("tool guard must be a function");
    const entry = { guard, ...(options.ownerSession === undefined ? {} : { ownerSession: options.ownerSession }) }; this.#guards.push(entry);
    let active = true; return () => { if (!active) return; active = false; const index = this.#guards.indexOf(entry); if (index >= 0) this.#guards.splice(index, 1); };
  }

  filterModelDefinitions(filter: (definition: ModelToolDefinition, sessionId?: import("@seal-harness/core").SessionId) => boolean): () => void {
    this.#modelFilters.push(filter); let active = true;
    return () => { if (!active) return; active = false; const index = this.#modelFilters.indexOf(filter); if (index >= 0) this.#modelFilters.splice(index, 1); };
  }

  definitions(sessionId?: import("@seal-harness/core").SessionId, options: { readonly includeHidden?: boolean } = {}): readonly ModelToolDefinition[] {
    return [...this.#tools.values()].flatMap((entries) => {
      const entry = sessionId === undefined
        ? entries.find((candidate) => candidate.ownerSession === undefined)
        : entries.find((candidate) => candidate.ownerSession === sessionId) ?? entries.find((candidate) => candidate.ownerSession === undefined && this.#admitted(sessionId, candidate.tool.name));
      if (entry === undefined) return [];
      const definition = { name: entry.tool.name, description: entry.tool.description, inputSchema: entry.tool.inputSchema };
      return options.includeHidden !== true && (entry.tool.modelVisible === false || this.#modelFilters.some((filter) => !filter(definition, sessionId))) ? [] : [definition];
    });
  }

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const entries = this.#tools.get(request.name);
    const selected = entries?.find((entry) => entry.ownerSession === request.sessionId)
      ?? entries?.find((entry) => entry.ownerSession === undefined && this.#admitted(request.sessionId, request.name));
    const tool = selected?.tool;
    if (tool === undefined) throw new ToolNotFoundError(request.name);
    if (!Check(Type.Unsafe({ ...tool.inputSchema }), request.input)) {
      throw new InvalidToolInputError(request.name);
    }

    const context = {
      callId: request.callId,
      sessionId: request.sessionId,
      cwd: request.cwd,
      signal: request.signal,
    };
    const action = tool.classify(request.input, context);
    for (const entry of this.#guards) {
      if (entry.ownerSession !== undefined && entry.ownerSession !== request.sessionId) continue;
      const reason = entry.guard({ ...request, action });
      if (reason !== undefined) throw new ToolDeniedError(request.name, reason);
    }
    const decision = await this.policy.decide(action, {
      sessionId: request.sessionId,
      cwd: request.cwd,
    });
    await this.emit("policy.decided", {
      sessionId: request.sessionId,
      action,
      decision,
    });

    if (decision.outcome === "deny") {
      throw new ToolDeniedError(request.name, decision.reason);
    }
    if (decision.outcome === "ask") {
      if (this.approval === undefined) throw new ApprovalUnavailableError(request.name);
      const approved = await this.approval.request({
        sessionId: request.sessionId,
        title: `Allow tool: ${request.name}`,
        message: decision.reason,
        ...(decision.details === undefined ? {} : { details: decision.details }),
        signal: request.signal,
      });
      if (!approved) throw new ToolDeniedError(request.name, "Approval declined");
    }

    const executed = await executeWithTimeout(tool, request.input, context, request.reportProgress ?? (() => {}));
    const result = await spillResult(executed, request, typeof this.maxResultBytes === "function" ? this.maxResultBytes() : this.maxResultBytes, this.spillStore);
    await this.emit("tool.completed", {
      sessionId: request.sessionId,
      toolName: request.name,
      result,
    });
    return result;
  }

  #admitted(sessionId: import("@seal-harness/core").SessionId, name: string): boolean {
    for (const restriction of this.#restrictions.get(sessionId) ?? []) {
      if ((restriction.allow !== undefined && !restriction.allow.includes(name)) || restriction.deny?.includes(name)) return false;
    }
    return true;
  }
}

async function executeWithTimeout(tool: ToolDefinition, input: import("@seal-harness/core").JsonObject, context: Omit<ToolExecutionRequest, "name" | "input" | "reportProgress">, reportProgress: (content: readonly ContentBlock[]) => void): Promise<ToolResult> {
  const execution = { ...context, reportProgress, reportDispatch: context.reportDispatch ?? (async () => {}) };
  if (tool.timeoutMs === undefined) return tool.execute(input, execution);
  const timeout = new AbortController(); let expired = false;
  const timer = setTimeout(() => { expired = true; timeout.abort(new Error(`tool call timed out after ${tool.timeoutMs}ms`)); }, tool.timeoutMs);
  const signal = AbortSignal.any([context.signal, timeout.signal]);
  try {
    const result = await tool.execute(input, { ...execution, signal });
    if (!expired) return result;
    return { content: [{ type: "text", text: `Error: tool call timed out after ${tool.timeoutMs}ms` }], isError: true, details: { name: "ToolTimeoutError", code: "TOOL_TIMEOUT", timeoutMs: tool.timeoutMs } };
  } catch (error) {
    if (!expired) throw error;
    return { content: [{ type: "text", text: `Error: tool call timed out after ${tool.timeoutMs}ms` }], isError: true, details: { name: "ToolTimeoutError", code: "TOOL_TIMEOUT", timeoutMs: tool.timeoutMs } };
  } finally { clearTimeout(timer); }
}

export const toolsCorePlugin = definePlugin<ToolsCoreConfig, SealHarnessEvents>({
  name: "tools-core",
  provides: [toolServiceToken],
  requires: [policyServiceToken],
  optional: [approvalServiceToken, spillStoreToken, settingsServiceToken],
  setup(context, config) {
    const approval = context.has(approvalServiceToken)
      ? context.use(approvalServiceToken)
      : undefined;
    const configuredMax = positiveInlineBytes(config.maxResultBytes ?? 256 * 1024);
    const settings = context.has(settingsServiceToken) ? context.use(settingsServiceToken) : undefined;
    const settingsScope = settings?.register("tools", {
      base: { maxResultBytes: configuredMax },
      applies: "live",
      schema: { type: "object", properties: { maxResultBytes: { type: "integer", minimum: 0, title: "Maximum inline result bytes", description: "Larger plain-text tool results are stored as spill artifacts." } } },
      validate(value) { return { ...value, maxResultBytes: positiveInlineBytes(value.maxResultBytes as number) }; },
    });
    if (settingsScope !== undefined) context.effect(() => settingsScope.dispose());
    context.provide(
      toolServiceToken,
      new PolicyToolService(
        context.use(policyServiceToken),
        approval,
        context.emit,
        settingsScope === undefined ? configuredMax : () => settingsScope.get().value.maxResultBytes as number,
        context.has(spillStoreToken) ? context.use(spillStoreToken) : undefined,
      ),
    );
  },
});

async function spillResult(result: ToolResult, request: ToolExecutionRequest, maxBytes: number, store?: SpillStore): Promise<ToolResult> {
  if (request.name === "read" || store === undefined || result.content.some((block) => block.type !== "text")) return result;
  const fullText = result.content.map((block) => block.type === "text" ? block.text : "").join("");
  const totalBytes = Buffer.byteLength(fullText, "utf8");
  if (totalBytes <= maxBytes) return result;
  let ref;
  try {
    ref = await store.saveText({ owner: { sessionId: request.sessionId }, source: { toolName: request.name, callId: request.callId, label: "result" }, suggestedName: `${request.name}.txt`, content: fullText });
  } catch {
    return result;
  }
  const worstNotice = `(Omitted ${totalBytes} bytes. Full formatted result stored at: ${ref.locator}. ${ref.retrievalHint})`;
  const previewBudget = Math.max(0, maxBytes - Buffer.byteLength(worstNotice, "utf8") - 2);
  const retained = retainHeadTail(fullText, previewBudget);
  const omitted = totalBytes - Buffer.byteLength(retained, "utf8");
  const notice = `(Omitted ${omitted} bytes. Full formatted result stored at: ${ref.locator}. ${ref.retrievalHint})`;
  const replacement = retained.length === 0 ? notice : `${retained}\n\n${notice}`;
  if (Buffer.byteLength(replacement, "utf8") > maxBytes) return result;
  return { ...result, content: [{ type: "text", text: replacement }] };
}

function retainHeadTail(text: string, budget: number): string {
  const points = [...text];
  const take = (fromEnd: boolean, byteBudget: number): string => {
    const kept: string[] = []; let used = 0;
    const source = fromEnd ? [...points].reverse() : points;
    for (const point of source) { const bytes = Buffer.byteLength(point, "utf8"); if (used + bytes > byteBudget) break; kept.push(point); used += bytes; }
    return (fromEnd ? kept.reverse() : kept).join("");
  };
  return take(false, Math.ceil(budget / 2)) + take(true, Math.floor(budget / 2));
}

function positiveInlineBytes(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new TypeError("maxResultBytes must be a non-negative integer");
  return value;
}
