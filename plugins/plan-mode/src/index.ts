import { approvalServiceToken, contextServiceToken, planModeServiceToken, sessionStoreToken, text, toolServiceToken, type ApprovalService, type JsonObject, type JsonValue, type PlanModeService, type PlanModeState, type SealHarnessEvents, type SessionId, type SessionSnapshot, type SessionStore, type ToolDefinition } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface PlanModeConfig { readonly section: string; }
const KEY = "sealHarnessPlanMode";
export const EXIT_PLAN_MODE = "exit_plan_mode";

export class SessionPlanModeService implements PlanModeService {
  readonly #queues = new Map<SessionId, Promise<void>>();
  constructor(readonly sessions: SessionStore) {}
  async get(sessionId: SessionId): Promise<PlanModeState> { const session = await requiredSession(this.sessions, sessionId); return { active: readActive(session) }; }
  set(sessionId: SessionId, active: boolean): Promise<PlanModeState> { return enqueue(this.#queues, sessionId, async () => { for (let attempt = 0; attempt < 8; attempt += 1) { const session = await requiredSession(this.sessions, sessionId); if (readActive(session) === active) return { active }; try { await this.sessions.append({ id: sessionId, expectedVersion: session.version, events: [{ type: "session.metadata", payload: { patch: { [KEY]: { active } } } }] }); return { active }; } catch (error) { if (attempt === 7 || !(error instanceof Error) || error.name !== "SessionConflictError") throw error; } } return { active }; }); }
}

export const planModePlugin = definePlugin<PlanModeConfig, SealHarnessEvents>({
  name: "plan-mode", provides: [planModeServiceToken], requires: [sessionStoreToken, contextServiceToken, toolServiceToken], optional: [approvalServiceToken],
  setup(context, rawConfig) {
    const config = resolveConfig(rawConfig); const service = new SessionPlanModeService(context.use(sessionStoreToken)); context.provide(planModeServiceToken, service);
    context.effect(context.use(contextServiceToken).register({ name: "plan-mode-policy", async contribute(request) { return (await service.get(request.sessionId)).active ? { systemPrompt: config.section } : undefined; } }));
    context.effect(context.use(toolServiceToken).register(exitTool(service, context.has(approvalServiceToken) ? context.use(approvalServiceToken) : undefined)));
  },
});

export function resolveConfig(config: PlanModeConfig): PlanModeConfig { if (typeof config?.section !== "string" || !config.section.trim()) throw new Error("PlanModeConfig needs a non-empty string `section`"); const unknown = Object.keys(config).filter(key => key !== "section"); if (unknown.length) throw new Error(`PlanModeConfig has unknown key(s) ${unknown.join(", ")} — config is { section }`); return { section: config.section }; }

function exitTool(service: PlanModeService, approval: ApprovalService | undefined): ToolDefinition {
  return {
    name: EXIT_PLAN_MODE, description: "Use only in plan mode. Present the COMPLETE markdown plan, starting with a # heading, for user review. Approval exits plan mode; rejection keeps planning.",
    inputSchema: { type: "object", additionalProperties: false, required: ["plan"], properties: { plan: { type: "string", minLength: 1 } } },
    classify: (_input, context) => ({ kind: "tool", toolName: EXIT_PLAN_MODE, risk: "external", summary: "Review completed plan", target: context.cwd }),
    async execute(input, context) {
      if (!(await service.get(context.sessionId)).active) throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`);
      const plan = requiredString(input.plan); if (!/^#\s+\S/.test(plan.trim())) throw new Error(`${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`);
      if (approval === undefined) throw new Error("no approval channel is available to review the plan; switch the Session mode manually instead");
      const approved = await approval.request({ sessionId: context.sessionId, title: firstHeading(plan) ?? "Plan review", message: "Approve this plan and leave plan mode?", details: { kind: "plan-review", plan }, signal: context.signal });
      if (!approved) throw new Error("The user chose to keep planning; revise the plan and present it again.");
      await service.set(context.sessionId, false);
      return { content: [text("Plan approved — plan mode exited; carry out the plan starting with your next step.")], details: { approved: true } };
    },
  };
}

function readActive(session: SessionSnapshot): boolean { let active = false; for (const entry of session.events) { const raw = entry.event.type === "session.created" ? entry.event.payload.metadata?.[KEY] : entry.event.type === "session.metadata" ? entry.event.payload.patch[KEY] : undefined; if (record(raw) && typeof raw.active === "boolean") active = raw.active; } return active; }
function firstHeading(plan: string): string | undefined { for (const line of plan.split("\n")) { const match = /^#{1,6}\s+(.+?)\s*$/.exec(line); if (match) return match[1]; } return undefined; }
function requiredString(value: JsonValue | undefined): string { if (typeof value !== "string" || !value.trim()) throw new Error("plan must be non-empty"); return value; }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function requiredSession(sessions: SessionStore, id: SessionId): Promise<SessionSnapshot> { const session = await sessions.read(id); if (!session) throw new Error(`Session not found: ${id}`); return session; }
function enqueue<T>(queues: Map<SessionId, Promise<void>>, id: SessionId, work: () => Promise<T>): Promise<T> { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); const previous = queues.get(id) ?? Promise.resolve(); const queued = previous.catch(() => undefined).then(async () => { try { resolve(await work()); } catch (error) { reject(error); } }); queues.set(id, queued); void queued.finally(() => { if (queues.get(id) === queued) queues.delete(id); }); return result; }
