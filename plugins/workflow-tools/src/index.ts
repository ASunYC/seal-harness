import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import {
  contextServiceToken, sessionId, sessionStoreToken, subagentServiceToken, text, toolServiceToken,
  type JsonObject, type JsonSchema, type JsonValue, type ModelRef, type SealHarnessEvents,
  type SessionId, type SessionStore, type SubagentService, type SubagentSnapshot, type ToolDefinition,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
import { Type } from "typebox";
import { Check } from "typebox/value";

export interface WorkflowToolsConfig {
  readonly maxConcurrentAgents?: number; readonly maxTotalAgents?: number; readonly maxResultChars?: number;
  readonly maxItemsPerCall?: number; readonly syncTimeoutMs?: number; readonly cancellationGraceMs?: number; readonly idFactory?: () => string;
}
export interface WorkflowMeta { readonly name: string; readonly description: string; readonly whenToUse?: string; readonly phases?: readonly WorkflowPhase[] }
export interface WorkflowPhase { readonly title: string; readonly detail?: string; readonly provider?: string; readonly model?: string }
export interface WorkflowResult { readonly workflowId: string; readonly agentsStarted: number; readonly outcome: "completed" | "failed" | "aborted"; readonly value?: JsonValue; readonly error?: string }
interface ResolvedConfig { maxConcurrentAgents: number; maxTotalAgents: number; maxResultChars: number; maxItemsPerCall: number; syncTimeoutMs: number; cancellationGraceMs: number; idFactory(): string }
interface AgentOptions { label?: string; phase?: string; provider?: string; model?: string; schema?: JsonSchema }
interface WorkerAgentMessage { type: "agent"; id: number; prompt: string; options: AgentOptions }
type WorkerMessage = WorkerAgentMessage | { type: "phase"; title: string } | { type: "log"; message: string } | { type: "result"; outcome: WorkflowResult["outcome"]; value?: JsonValue; error?: string; agentsStarted: number };

export class WorkerWorkflowRunner {
  readonly config: ResolvedConfig;
  constructor(readonly subagents: SubagentService, readonly sessions: SessionStore, config: WorkflowToolsConfig = {}) {
    this.config = { maxConcurrentAgents: positive(config.maxConcurrentAgents ?? 8, "maxConcurrentAgents"), maxTotalAgents: positive(config.maxTotalAgents ?? 1_000, "maxTotalAgents"), maxResultChars: positive(config.maxResultChars ?? 50_000, "maxResultChars"), maxItemsPerCall: positive(config.maxItemsPerCall ?? 4_096, "maxItemsPerCall"), syncTimeoutMs: positive(config.syncTimeoutMs ?? 5_000, "syncTimeoutMs"), cancellationGraceMs: positive(config.cancellationGraceMs ?? 5_000, "cancellationGraceMs"), idFactory: config.idFactory ?? randomUUID };
  }

  async run(parentSessionId: SessionId, cwd: string, script: string, meta: WorkflowMeta, args: JsonObject | undefined, signal: AbortSignal): Promise<WorkflowResult> {
    validateMeta(meta); parseScript(script, meta.name); const workflowId = `workflow-${this.config.idFactory()}`;
    await append(this.sessions, parentSessionId, { type: "workflow.started", payload: { workflowId, name: meta.name } });
    const parentModel = await latestModel(this.sessions, parentSessionId);
    const workerUrl = import.meta.url.endsWith(".ts") ? new URL("../dist/worker.js", import.meta.url) : new URL("./worker.js", import.meta.url);
    const worker = new Worker(workerUrl, { workerData: { script, args, name: meta.name, maxConcurrentAgents: this.config.maxConcurrentAgents, maxTotalAgents: this.config.maxTotalAgents, maxItemsPerCall: this.config.maxItemsPerCall, syncTimeoutMs: this.config.syncTimeoutMs }, env: workflowEnvironment(), execArgv: [] });
    const children = new Map<number, SessionId>(); const cancelledChildren = new Set<SessionId>(); const agentTasks = new Set<Promise<void>>(); const runAbort = new AbortController(); let terminal = false; let cancellationTimer: NodeJS.Timeout | undefined;
    const settled = new Promise<WorkflowResult>((resolve) => {
      const finish = (result: WorkflowResult) => { if (terminal) return; terminal = true; resolve(result); };
      worker.on("message", (message: WorkerMessage) => {
        if (message.type === "agent") { const task = this.agent(worker, parentSessionId, cwd, workflowId, parentModel, children, message, runAbort.signal); agentTasks.add(task); void task.finally(() => agentTasks.delete(task)); }
        else if (message.type === "result") finish({ workflowId, agentsStarted: message.agentsStarted, outcome: message.outcome, ...(message.value === undefined ? {} : { value: message.value }), ...(message.error === undefined ? {} : { error: message.error }) });
      });
      worker.once("error", error => finish({ workflowId, agentsStarted: children.size, outcome: runAbort.signal.aborted ? "aborted" : "failed", error: error.message }));
      worker.once("exit", code => { if (!terminal) finish({ workflowId, agentsStarted: children.size, outcome: runAbort.signal.aborted ? "aborted" : "failed", error: `workflow worker exited with code ${code}` }); });
    });
    const cancel = () => { const reason = reasonText(signal.reason, "parent step aborted"); runAbort.abort(signal.reason); worker.postMessage({ type: "cancel", reason }); for (const child of children.values()) { cancelledChildren.add(child); void this.subagents.abort(parentSessionId, child, reason); } cancellationTimer = setTimeout(() => { void worker.terminate(); }, this.config.cancellationGraceMs); cancellationTimer.unref(); };
    signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
    let result: WorkflowResult;
    try { result = await settled; } finally { signal.removeEventListener("abort", cancel); }
    runAbort.abort(new Error("workflow settled"));
    await Promise.all([...children.values()].filter(child => !cancelledChildren.has(child)).map(child => this.subagents.abort(parentSessionId, child, "workflow settled").catch(() => false)));
    await Promise.allSettled([...agentTasks]);
    if (cancellationTimer !== undefined) clearTimeout(cancellationTimer); await worker.terminate();
    await append(this.sessions, parentSessionId, { type: "workflow.completed", payload: { workflowId, outcome: result.outcome, agentsStarted: result.agentsStarted, ...(result.error === undefined ? {} : { error: result.error }) } });
    return result;
  }

  private async agent(worker: Worker, parent: SessionId, cwd: string, workflowId: string, parentModel: ModelRef, children: Map<number, SessionId>, message: WorkerAgentMessage, signal: AbortSignal): Promise<void> {
    let childId: SessionId | undefined; let completionRecorded = false;
    try {
      signal.throwIfAborted();
      const options = message.options; if (options.schema !== undefined) assertWorkflowSchema(options.schema);
      const model = { provider: options.provider ?? parentModel.provider, model: options.model ?? parentModel.model }; const label = options.label?.trim() || defaultLabel(message.prompt);
      const child = await this.subagents.spawn({ parentSessionId: parent, cwd, prompt: message.prompt, label, model }); childId = child.sessionId; children.set(message.id, child.sessionId);
      await append(this.sessions, parent, { type: "workflow.agent.started", payload: { workflowId, sequence: message.id, label, childSessionId: child.sessionId, ...(options.phase === undefined ? {} : { phase: options.phase }) } });
      const final = await waitForChild(this.subagents, parent, child.sessionId, signal);
      if (final.status !== "completed") { await append(this.sessions, parent, { type: "workflow.agent.completed", payload: { workflowId, sequence: message.id, outcome: final.status === "aborted" ? "aborted" : "failed" } }); completionRecorded = true; worker.postMessage({ type: "agent-result", id: message.id, ok: true, value: null }); return; }
      if (options.schema === undefined) { await append(this.sessions, parent, { type: "workflow.agent.completed", payload: { workflowId, sequence: message.id, outcome: "completed" } }); completionRecorded = true; worker.postMessage({ type: "agent-result", id: message.id, ok: true, value: final.result ?? "" }); return; }
      let value: JsonValue;
      try { value = parseStructured(final.result ?? ""); if (!Check(Type.Unsafe(options.schema), value)) throw new Error("child result does not match schema"); }
      catch { await append(this.sessions, parent, { type: "workflow.agent.completed", payload: { workflowId, sequence: message.id, outcome: "failed" } }); completionRecorded = true; worker.postMessage({ type: "agent-result", id: message.id, ok: true, value: null }); return; }
      await append(this.sessions, parent, { type: "workflow.agent.completed", payload: { workflowId, sequence: message.id, outcome: "completed" } }); completionRecorded = true;
      worker.postMessage({ type: "agent-result", id: message.id, ok: true, value });
    } catch (error) { if (childId !== undefined && !completionRecorded) await append(this.sessions, parent, { type: "workflow.agent.completed", payload: { workflowId, sequence: message.id, outcome: signal.aborted ? "aborted" : "failed" } }).catch(() => {}); worker.postMessage({ type: "agent-result", id: message.id, ok: false, error: reasonText(error, "child agent failed"), fatal: true }); }
  }
}

export const workflowToolsPlugin = definePlugin<WorkflowToolsConfig, SealHarnessEvents>({
  name: "workflow-tools", requires: [subagentServiceToken, sessionStoreToken, toolServiceToken, contextServiceToken],
  setup(context, config) {
    const runner = new WorkerWorkflowRunner(context.use(subagentServiceToken), context.use(sessionStoreToken), config);
    context.effect(context.use(toolServiceToken).register(workflowTool(runner)));
    context.effect(context.use(contextServiceToken).register({ name: "workflow-guidance", async contribute() { return { systemPrompt: "Use workflow only when the user explicitly requests a workflow or large multi-agent orchestration. For one or two delegations, use ordinary subagent tools." }; } }));
  },
});

export function workflowTool(runner: WorkerWorkflowRunner): ToolDefinition {
  return {
    name: "workflow", description: DESCRIPTION,
    inputSchema: { type: "object", additionalProperties: false, required: ["script", "meta"], properties: { script: { type: "string", minLength: 1 }, meta: { type: "object", additionalProperties: false, required: ["name", "description"], properties: { name: { type: "string", minLength: 1 }, description: { type: "string", minLength: 1 }, whenToUse: { type: "string" }, phases: { type: "array", items: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1 }, detail: { type: "string" }, provider: { type: "string" }, model: { type: "string" } } } } } }, args: { type: "object", additionalProperties: true } } },
    classify: (_input, context) => ({ kind: "tool", toolName: "workflow", risk: "workspace-write", summary: "Run a multi-agent workflow", target: context.cwd }),
    async execute(input, context) {
      const script = input.script as string; const meta = input.meta as unknown as WorkflowMeta; const args = input.args as JsonObject | undefined;
      const result = await runner.run(context.sessionId, context.cwd, script, meta, args, context.signal);
      if (result.outcome !== "completed") throw new Error(`workflow run ${result.outcome}: ${result.error ?? "unknown error"}`);
      const rendered = JSON.stringify(result.value ?? null, null, 2); const clipped = rendered.length > runner.config.maxResultChars ? `${rendered.slice(0, runner.config.maxResultChars)}\n… [truncated: ${rendered.length - runner.config.maxResultChars} more characters]` : rendered;
      return { content: [text(`workflow "${meta.name}" completed (${result.agentsStarted} agents).\nReturn value:\n${clipped}`)], details: { workflowId: result.workflowId, agentsStarted: result.agentsStarted, result: result.value ?? null } };
    },
  };
}

const DESCRIPTION = "Run a foreground JavaScript workflow that orchestrates subagents. The script body supports top-level await and must return JSON. Available globals: agent(prompt, {label?, phase?, provider?, model?, schema?}), parallel(thunks), pipeline(items, ...stages), phase(title), log(message), and args. The isolated worker has no filesystem, network, timers, or Node APIs. Child failures resolve to null; invalid hook usage, caps, cancellation, and infrastructure failures stop the workflow.";
function validateMeta(meta: WorkflowMeta): void { if (typeof meta?.name !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(meta.name)) throw new Error("workflow meta.name must be short kebab-case"); if (typeof meta.description !== "string" || !meta.description.trim()) throw new Error("workflow meta.description must be non-empty"); const titles = new Set<string>(); for (const phase of meta.phases ?? []) { if (!phase.title?.trim() || titles.has(phase.title)) throw new Error("workflow phase titles must be non-empty and unique"); titles.add(phase.title); } }
function parseScript(script: string, name: string): void { if (!script.trim()) throw new Error("workflow script must be non-empty"); try { new vm.Script(`(async()=>{\n${script}\n})()`, { filename: `workflow:${name}` }); } catch (error) { throw new Error(`workflow script does not parse: ${reasonText(error, "syntax error")}`); } }
async function latestModel(store: SessionStore, id: SessionId): Promise<ModelRef> { const session = await store.read(id); const event = session?.events.slice().reverse().find(item => item.event.type === "run.started"); if (event?.event.type !== "run.started") throw new Error(`parent Session has no model route: ${id}`); return event.event.payload.model; }
async function waitForChild(service: SubagentService, parent: SessionId, child: SessionId, signal: AbortSignal): Promise<SubagentSnapshot> { while (true) { signal.throwIfAborted(); const waited = await service.wait(parent, [child], 120_000, signal); if (waited.completed[0] !== undefined) return waited.completed[0]; } }
async function append(store: SessionStore, id: SessionId, event: import("@seal-harness/core").SessionEvent): Promise<void> { for (let attempt = 0; attempt < 8; attempt += 1) { const session = await store.read(id); if (session === undefined) throw new Error(`Session not found: ${id}`); try { await store.append({ id, expectedVersion: session.version, events: [event] }); return; } catch (error) { if (attempt === 7 || !(error instanceof Error) || error.name !== "SessionConflictError") throw error; } } }
function parseStructured(value: string): JsonValue { try { return JSON.parse(value) as JsonValue; } catch (error) { throw new Error(`child structured result is not JSON: ${reasonText(error, "parse error")}`); } }
function assertWorkflowSchema(schema: JsonSchema): void {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "oneOf", "description"]);
  const visit = (value: unknown, root: boolean): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("workflow child schema nodes must be objects");
    const record = value as Record<string, unknown>; for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`workflow child schema keyword is unsupported: ${key}`);
    if (root && record.type !== "object") throw new Error("workflow child schema root must have type object");
    if (record.properties !== undefined) { if (typeof record.properties !== "object" || record.properties === null || Array.isArray(record.properties)) throw new Error("workflow child schema properties must be an object"); for (const child of Object.values(record.properties)) visit(child, false); }
    if (record.items !== undefined) visit(record.items, false);
    if (record.oneOf !== undefined) { if (!Array.isArray(record.oneOf) || record.oneOf.length === 0) throw new Error("workflow child schema oneOf must be a non-empty array"); for (const child of record.oneOf) visit(child, false); }
  };
  visit(schema, true);
}
function defaultLabel(prompt: string): string { const line = prompt.split("\n", 1)[0] ?? prompt; return line.length <= 48 ? line : `${line.slice(0, 47)}…`; }
function reasonText(value: unknown, fallback: string): string { return value instanceof Error ? value.message : typeof value === "string" ? value : fallback; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`); return value; }
function workflowEnvironment(): NodeJS.ProcessEnv { return process.platform === "win32" ? { TMP: tmpdir(), TEMP: tmpdir() } : {}; }
