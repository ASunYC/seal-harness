import { sessionStoreToken, text, todoServiceToken, toolServiceToken, type JsonObject, type JsonValue, type SealHarnessEvents, type SessionId, type SessionSnapshot, type SessionStore, type TodoItem, type TodoService, type TodoStatus, type ToolDefinition } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface TodoToolsConfig { readonly allowParallelInProgress: boolean; }
const KEY = "sealHarnessTodos";
const statuses: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

export class SessionTodoService implements TodoService {
  readonly #queues = new Map<SessionId, Promise<void>>();
  constructor(readonly sessions: SessionStore) {}
  async get(sessionId: SessionId): Promise<readonly TodoItem[] | undefined> { const session = await this.sessions.read(sessionId); if (!session) throw new Error(`Session not found: ${sessionId}`); return readTodos(session); }
  replace(sessionId: SessionId, todos: readonly TodoItem[]): Promise<readonly TodoItem[]> {
    const detached = todos.map(todo => ({ content: todo.content, status: todo.status }));
    return enqueue(this.#queues, sessionId, async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const session = await this.sessions.read(sessionId); if (!session) throw new Error(`Session not found: ${sessionId}`);
        try { await this.sessions.append({ id: sessionId, expectedVersion: session.version, events: [{ type: "session.metadata", payload: { patch: { [KEY]: detached.map(todo => ({ ...todo })) } } }] }); return detached; }
        catch (error) { if (attempt === 7 || !(error instanceof Error) || error.name !== "SessionConflictError") throw error; }
      }
      return detached;
    });
  }
}

export const todoToolsPlugin = definePlugin<TodoToolsConfig, SealHarnessEvents>({
  name: "todo-tools", provides: [todoServiceToken], requires: [sessionStoreToken, toolServiceToken],
  setup(context, config) {
    if (typeof config.allowParallelInProgress !== "boolean") throw new TypeError("allowParallelInProgress must be a boolean");
    const service = new SessionTodoService(context.use(sessionStoreToken)); context.provide(todoServiceToken, service);
    context.effect(context.use(toolServiceToken).register(todoTool(service, config.allowParallelInProgress)));
  },
});

function todoTool(service: TodoService, allowParallel: boolean): ToolDefinition {
  return {
    name: "todo_write", description: "Record and update a structured task list. Send the ENTIRE list every call; it replaces the previous list. " + (allowParallel ? "Mark every task actively worked on in_progress; several may be active during genuine parallel work. " : "Keep at most one task in_progress. ") + "Statuses: pending, in_progress, completed.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["todos"],
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["content", "status"],
            properties: { content: { type: "string" }, status: { type: "string", enum: statuses } },
          },
        },
      },
    },
    classify: (_input, context) => ({ kind: "tool", toolName: "todo_write", risk: "workspace-write", summary: "Update todo list", target: context.cwd }),
    async execute(input, context) {
      const todos = validateTodos(input.todos, allowParallel); const saved = await service.replace(context.sessionId, todos);
      const count = (status: TodoStatus) => saved.filter(todo => todo.status === status).length;
      const counts = { pending: count("pending"), inProgress: count("in_progress"), completed: count("completed") };
      return { content: [text(`Updated todo list: ${counts.pending} pending, ${counts.inProgress} in progress, ${counts.completed} completed.`)], details: { todos: saved.map(todo => ({ ...todo })), counts } };
    },
  };
}

function validateTodos(raw: JsonValue | undefined, allowParallel: boolean): TodoItem[] {
  if (!Array.isArray(raw)) throw new Error("invalid todos: expected an array"); const result: TodoItem[] = []; const seen = new Set<string>(); let active = 0;
  for (const rawItem of raw) { if (!record(rawItem) || Object.keys(rawItem).some(key => key !== "content" && key !== "status")) throw new Error("invalid todo item"); const content = typeof rawItem.content === "string" ? rawItem.content.trim() : ""; if (!content) throw new Error("invalid todo: `content` must be a non-empty string"); if (seen.has(content)) throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`); if (!statuses.includes(rawItem.status as TodoStatus)) throw new Error("invalid todo status"); const status = rawItem.status as TodoStatus; if (status === "in_progress") active += 1; seen.add(content); result.push({ content, status }); }
  if (!allowParallel && active > 1) throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`); return result;
}
function readTodos(session: SessionSnapshot): readonly TodoItem[] | undefined { let raw: JsonValue | undefined; let writeSequence = 0; let turnSequence = 0; for (const entry of session.events) { if (entry.event.type === "session.metadata" && KEY in entry.event.payload.patch) { raw = entry.event.payload.patch[KEY]; writeSequence = entry.sequence; } if (entry.event.type === "turn.started") turnSequence = entry.sequence; } return raw === undefined || turnSequence > writeSequence ? undefined : validateTodos(raw, true); }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function enqueue<T>(queues: Map<SessionId, Promise<void>>, id: SessionId, work: () => Promise<T>): Promise<T> { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); const previous = queues.get(id) ?? Promise.resolve(); const queued = previous.catch(() => undefined).then(async () => { try { resolve(await work()); } catch (error) { reject(error); } }); queues.set(id, queued); void queued.finally(() => { if (queues.get(id) === queued) queues.delete(id); }); return result; }
