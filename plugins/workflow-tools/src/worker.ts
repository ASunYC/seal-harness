import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

interface AgentOptions { label?: string; phase?: string; provider?: string; model?: string; schema?: unknown }
interface StartData { script: string; args?: unknown; name: string; maxConcurrentAgents: number; maxTotalAgents: number; maxItemsPerCall: number; syncTimeoutMs: number }
type ParentMessage = { type: "agent-result"; id: number; ok: true; value: unknown } | { type: "agent-result"; id: number; ok: false; error: string; fatal?: boolean } | { type: "cancel"; reason: string };
if (parentPort === null) throw new Error("workflow worker requires parent port");
const port = parentPort;
const data = workerData as StartData;
let cancelled: Error | undefined;
let sequence = 0;
let active = 0;
let currentPhase: string | undefined;
const waiters: Array<{ resolve(): void; reject(reason: unknown): void }> = [];
const pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();

class FatalWorkflowError extends Error { readonly fatal = true }
port.on("message", (message: ParentMessage) => {
  if (message.type === "cancel") {
    cancelled ??= new FatalWorkflowError(`workflow cancelled: ${message.reason}`);
    for (const waiter of waiters.splice(0)) waiter.reject(cancelled);
    for (const item of pending.values()) item.reject(cancelled);
    pending.clear();
    return;
  }
  const item = pending.get(message.id); if (item === undefined) return; pending.delete(message.id);
  if (message.ok) item.resolve(message.value); else item.reject(message.fatal ? new FatalWorkflowError(message.error) : new Error(message.error));
});

function checkCancelled(): void { if (cancelled !== undefined) throw cancelled; }
async function acquire(): Promise<void> { checkCancelled(); if (active < data.maxConcurrentAgents) { active += 1; return; } await new Promise<void>((resolve, reject) => waiters.push({ resolve: () => { active += 1; resolve(); }, reject })); checkCancelled(); }
function release(): void { active -= 1; waiters.shift()?.resolve(); }
function plainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readOptions(raw: unknown): AgentOptions {
  if (raw === undefined) return {}; if (!plainObject(raw)) throw new FatalWorkflowError("agent() options must be an object");
  const allowed = new Set(["label", "phase", "provider", "model", "schema"]); for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new FatalWorkflowError(`agent() option is not recognized: ${key}`);
  for (const key of ["label", "phase", "provider", "model"] as const) if (raw[key] !== undefined && typeof raw[key] !== "string") throw new FatalWorkflowError(`agent() option ${key} must be a string`);
  return structuredClone(raw) as AgentOptions;
}
async function agent(prompt: unknown, rawOptions?: unknown): Promise<unknown> {
  checkCancelled(); if (typeof prompt !== "string" || prompt.length === 0) throw new FatalWorkflowError("agent() requires a non-empty prompt string");
  if (sequence >= data.maxTotalAgents) throw new FatalWorkflowError(`workflow reached its total agent cap (${data.maxTotalAgents})`);
  const options = readOptions(rawOptions); const id = ++sequence; await acquire();
  try { checkCancelled(); port.postMessage({ type: "agent", id, prompt, options: { ...options, phase: options.phase ?? currentPhase } }); return await new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
  finally { release(); }
}
async function parallel(raw: unknown): Promise<unknown[]> { checkCancelled(); if (!Array.isArray(raw) || raw.some(value => typeof value !== "function")) throw new FatalWorkflowError("parallel() requires an array of functions"); if (raw.length > data.maxItemsPerCall) throw new FatalWorkflowError(`parallel() exceeds the item cap (${data.maxItemsPerCall})`); return Promise.all(raw.map(async thunk => { try { return await thunk(); } catch (error) { if (error instanceof FatalWorkflowError) throw error; return null; } })); }
async function pipeline(rawItems: unknown, ...stages: unknown[]): Promise<unknown[]> { checkCancelled(); if (!Array.isArray(rawItems) || stages.length === 0 || stages.some(value => typeof value !== "function")) throw new FatalWorkflowError("pipeline() requires an item array and one or more stage functions"); if (rawItems.length > data.maxItemsPerCall) throw new FatalWorkflowError(`pipeline() exceeds the item cap (${data.maxItemsPerCall})`); return Promise.all(rawItems.map(async (item, index) => { let value: unknown = item; for (const stage of stages as Array<(previous: unknown, item: unknown, index: number) => unknown>) { try { value = await stage(value, item, index); } catch (error) { if (error instanceof FatalWorkflowError) throw error; return null; } } return value; })); }
function phase(title: unknown): void { checkCancelled(); if (typeof title !== "string" || title.length === 0) throw new FatalWorkflowError("phase() requires a non-empty string"); currentPhase = title; port.postMessage({ type: "phase", title }); }
function log(message: unknown): void { checkCancelled(); if (typeof message !== "string") throw new FatalWorkflowError("log() requires a string"); port.postMessage({ type: "log", message }); }

const context = vm.createContext({ agent: Object.freeze(agent), parallel: Object.freeze(parallel), pipeline: Object.freeze(pipeline), phase: Object.freeze(phase), log: Object.freeze(log), args: structuredClone(data.args ?? {}) }, { name: `workflow:${data.name}` });
void (async () => {
  try {
    const script = new vm.Script(`(async()=>{\n${data.script}\n})()`, { filename: `workflow:${data.name}`, lineOffset: -1 });
    const value = await script.runInContext(context, { timeout: data.syncTimeoutMs }); checkCancelled();
    const cloned = structuredClone(value === undefined ? null : value); port.postMessage({ type: "result", outcome: "completed", value: cloned, agentsStarted: sequence });
  } catch (error) { port.postMessage({ type: "result", outcome: cancelled === undefined ? "failed" : "aborted", error: error instanceof Error ? error.message : String(error), agentsStarted: sequence }); }
})();
