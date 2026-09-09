import type { SessionId } from "./ids.js";

export type TodoStatus = "pending" | "in_progress" | "completed";
export interface TodoItem { readonly content: string; readonly status: TodoStatus; }
export interface TodoService {
  get(sessionId: SessionId): Promise<readonly TodoItem[] | undefined>;
  replace(sessionId: SessionId, todos: readonly TodoItem[]): Promise<readonly TodoItem[]>;
}
