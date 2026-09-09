import type { ContentBlock } from "./content.js";
import type { ModelRef } from "./model.js";
import type { SessionId } from "./ids.js";

export type TeamMemberStatus = "running" | "idle" | "inactive" | "provisioning" | "failed";
export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted";
export type TeamTaskAction = "claim" | "release" | "edit" | "set_dependencies" | "complete" | "reopen" | "reassign" | "delete";

export interface TeamMemberView {
  readonly id: SessionId;
  readonly name: string;
  readonly role: "lead" | "teammate";
  readonly status: TeamMemberStatus;
  readonly description?: string;
  readonly context?: "fresh" | "fork";
  readonly model?: ModelRef;
  readonly diagnostics: readonly string[];
}

export interface TeamTaskView {
  readonly id: string;
  readonly revision: number;
  readonly subject: string;
  readonly description: string;
  readonly status: TeamTaskStatus;
  readonly ownerName?: string;
  readonly blockedBy: readonly string[];
  readonly writeScopes: readonly string[];
  readonly ready: boolean;
  readonly writeScopeWarnings: readonly string[];
}

export interface TeamView {
  readonly id: SessionId;
  readonly caller: string;
  readonly members: readonly TeamMemberView[];
  readonly tasks: readonly TeamTaskView[];
}

export interface SpawnTeammateRequest {
  readonly name: string;
  readonly description: string;
  readonly prompt: readonly ContentBlock[];
  readonly context?: "fresh" | "fork";
  readonly model?: ModelRef;
  readonly signal?: AbortSignal;
}

export interface SendTeamMessageRequest {
  readonly target: string;
  readonly content: readonly ContentBlock[];
  readonly signal?: AbortSignal;
}

export interface CreateTeamTaskRequest {
  readonly subject: string;
  readonly description: string;
  readonly blockedBy?: readonly string[];
  readonly writeScopes?: readonly string[];
}

export interface UpdateTeamTaskRequest {
  readonly taskId: string;
  readonly expectedRevision: number;
  readonly action: TeamTaskAction;
  readonly subject?: string;
  readonly description?: string;
  readonly blockedBy?: readonly string[];
  readonly writeScopes?: readonly string[];
  readonly owner?: string;
}

export interface TeamService {
  view(caller: SessionId): Promise<TeamView>;
  spawnTeammate(caller: SessionId, request: SpawnTeammateRequest): Promise<TeamMemberView>;
  sendMessage(caller: SessionId, request: SendTeamMessageRequest): Promise<{ readonly messageId: string; readonly status: "accepted" | "queued" }>;
  listMembers(caller: SessionId): Promise<readonly TeamMemberView[]>;
  waitForChange(caller: SessionId, timeoutMs: number, signal?: AbortSignal): Promise<{ readonly timedOut: boolean }>;
  interrupt(caller: SessionId, target: string): Promise<{ readonly previousStatus: "running" | "idle" | "inactive" }>;
  createTask(caller: SessionId, request: CreateTeamTaskRequest): Promise<TeamTaskView>;
  listTasks(caller: SessionId): Promise<readonly TeamTaskView[]>;
  getTask(caller: SessionId, taskId: string): Promise<TeamTaskView>;
  updateTask(caller: SessionId, request: UpdateTeamTaskRequest): Promise<TeamTaskView>;
}

export class TeamError extends Error {
  override readonly name = "TeamError";
  constructor(message: string, readonly code: string) { super(message); }
}
