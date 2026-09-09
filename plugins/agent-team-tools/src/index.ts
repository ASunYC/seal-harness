import {
  contextServiceToken, teamServiceToken, text, toolServiceToken,
  type JsonObject, type SealHarnessEvents, type TeamMemberView, type TeamService, type ToolDefinition,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

const POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

send_message steers a running target, starts an idle target, and cold-resumes an inactive teammate. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Before wait_agent, use list_agents and ensure another required member is running or provisioning. The Lead must wait for required teammates before giving the final answer.`;

export const agentTeamToolsPlugin = definePlugin<Record<string, never>, SealHarnessEvents>({
  name: "agent-team-tools", requires: [teamServiceToken, toolServiceToken, contextServiceToken],
  setup(context) {
    const teams = context.use(teamServiceToken); const tools = context.use(toolServiceToken);
    context.effect(context.use(contextServiceToken).register({ name: "agent-team-policy", async contribute(request) { try { const view = await teams.view(request.sessionId); return { systemPrompt: `${POLICY}\n\nYour Team role is ${view.caller === "lead" ? "lead" : "teammate"}; your Team name is ${view.caller}; Team id is ${view.id}.` }; } catch { return undefined; } } }));
    for (const definition of definitions(teams)) context.effect(tools.register(definition));
  },
});

export function definitions(teams: TeamService): ToolDefinition[] { return [
  tool("spawn_teammate", "Create one named, durable teammate. Only the Team Lead may call this tool.", schema({ name: str(), description: str(), prompt: str(), context: { type: "string", enum: ["fresh", "fork"] } }, ["name", "description", "prompt"]), async (input, ctx) => teams.spawnTeammate(ctx.sessionId, { name: required(input, "name"), description: required(input, "description"), prompt: [text(required(input, "prompt"))], context: input.context === "fork" ? "fork" : "fresh", signal: ctx.signal })),
  tool("send_message", "Send one durable message to another Team member.", schema({ target: str(), message: str() }, ["target", "message"]), (input, ctx) => teams.sendMessage(ctx.sessionId, { target: required(input, "target"), content: [text(required(input, "message"))], signal: ctx.signal })),
  tool("list_agents", "List the Lead and every durable teammate with current runtime status.", schema({}, []), async (_input, ctx) => teams.listMembers(ctx.sessionId)),
  tool("wait_agent", "Wait for the next teammate status, mailbox, or shared-task change after this call starts.", schema({ timeout_ms: { type: "integer", minimum: 10000, maximum: 3600000 } }, []), async (input, ctx) => { const members = await teams.listMembers(ctx.sessionId); if (!members.some(member => member.id !== ctx.sessionId && active(member))) return { timedOut: false, noProgress: { reason: "no-active-peer", message: "No other Team member is running or provisioning. Use send_message to wake each required inactive teammate before waiting again." } }; return teams.waitForChange(ctx.sessionId, typeof input.timeout_ms === "number" ? input.timeout_ms : 30_000, ctx.signal); }),
  tool("interrupt_agent", "Interrupt one teammate's current turn while preserving its pending inbox. Team Lead only.", schema({ target: str() }, ["target"]), (input, ctx) => teams.interrupt(ctx.sessionId, required(input, "target"))),
  tool("team_task_create", "Create one unowned pending task on the shared Team task board.", schema({ subject: str(), description: str(), blocked_by: strings(), write_scopes: strings() }, ["subject", "description"]), (input, ctx) => teams.createTask(ctx.sessionId, { subject: required(input, "subject"), description: required(input, "description"), blockedBy: stringList(input.blocked_by), writeScopes: stringList(input.write_scopes) })),
  tool("team_task_list", "List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.", schema({ status: { type: "string", enum: ["pending", "in_progress", "completed"] }, owner: { type: "string" }, ready: { type: "boolean" }, cursor: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, []), async (input, ctx) => { const all = (await teams.listTasks(ctx.sessionId)).filter(task => (input.status === undefined || task.status === input.status) && (input.owner === undefined || (input.owner === "unowned" ? task.ownerName === undefined : task.ownerName === input.owner)) && (input.ready === undefined || task.ready === input.ready)); const cursor = typeof input.cursor === "number" ? input.cursor : 0; const limit = typeof input.limit === "number" ? input.limit : 50; return { tasks: all.slice(cursor, cursor + limit), ...(cursor + limit < all.length ? { nextCursor: cursor + limit } : {}) }; }),
  tool("team_task_get", "Read the complete latest value of one shared task before changing or executing it.", schema({ task_id: str() }, ["task_id"]), (input, ctx) => teams.getTask(ctx.sessionId, required(input, "task_id"))),
  tool("team_task_update", "Compare-and-set a shared task action using its latest revision.", schema({ task_id: str(), expected_revision: { type: "integer", minimum: 1 }, action: { type: "string", enum: ["claim", "release", "edit", "set_dependencies", "complete", "reopen", "reassign", "delete"] }, subject: { type: "string" }, description: { type: "string" }, blocked_by: strings(), write_scopes: strings(), owner: { type: "string" } }, ["task_id", "expected_revision", "action"]), (input, ctx) => teams.updateTask(ctx.sessionId, { taskId: required(input, "task_id"), expectedRevision: Number(input.expected_revision), action: input.action as never, ...(typeof input.subject === "string" ? { subject: input.subject } : {}), ...(typeof input.description === "string" ? { description: input.description } : {}), ...(Array.isArray(input.blocked_by) ? { blockedBy: stringList(input.blocked_by) } : {}), ...(Array.isArray(input.write_scopes) ? { writeScopes: stringList(input.write_scopes) } : {}), ...(typeof input.owner === "string" ? { owner: input.owner } : {}) })),
]; }

type TeamToolExecute = (input: JsonObject, context: Parameters<ToolDefinition["execute"]>[1]) => unknown | Promise<unknown>;
function tool(name: string, description: string, inputSchema: JsonObject, execute: TeamToolExecute): ToolDefinition { return { name, description, inputSchema, classify: (_input, context) => ({ kind: "tool", toolName: name, risk: "read", summary: description, target: context.cwd }), async execute(input, context) { const value = await execute(input, context); return { content: [text(JSON.stringify(value))], details: value as JsonObject }; } }; }
function schema(properties: JsonObject, required: readonly string[]): JsonObject { return { type: "object", properties, required, additionalProperties: false }; }
function str(): JsonObject { return { type: "string", minLength: 1 }; }
function strings(): JsonObject { return { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true }; }
function required(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`); return value; }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function active(member: TeamMemberView): boolean { return member.status === "running" || member.status === "provisioning"; }
