import type { SessionId } from "./ids.js";

export type GoalPhase = "active" | "paused" | "blocked" | "complete";
export type GoalActivation = "armed" | "disarmed";

export interface GoalRef {
  readonly id: string;
  readonly revision: number;
}

export interface GoalBlockReason {
  readonly code: string;
  readonly message: string;
}

export interface GoalSnapshot extends GoalRef {
  readonly objective: string;
  readonly phase: GoalPhase;
  readonly maxGoalRounds: number;
  readonly roundsStarted: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly blockedReason?: GoalBlockReason;
}

export interface GoalView extends GoalSnapshot {
  readonly activation: GoalActivation;
}

export interface CreateGoalRequest {
  readonly objective: string;
  readonly maxGoalRounds?: number;
}

export interface EditGoalRequest {
  readonly objective?: string;
  readonly maxGoalRounds?: number;
}

export interface GoalService {
  get(sessionId: SessionId): Promise<GoalView | undefined>;
  create(sessionId: SessionId, request: CreateGoalRequest): Promise<GoalView>;
  edit(sessionId: SessionId, ref: GoalRef, request: EditGoalRequest): Promise<GoalView>;
  pause(sessionId: SessionId, ref: GoalRef): Promise<GoalView>;
  resume(sessionId: SessionId, ref: GoalRef): Promise<GoalView>;
  complete(sessionId: SessionId, ref: GoalRef): Promise<GoalView>;
  /** Clear the exact current goal and return its one-past tombstone revision. */
  clear(sessionId: SessionId, ref: GoalRef): Promise<GoalRef>;
  block(sessionId: SessionId, ref: GoalRef, reason: GoalBlockReason): Promise<GoalView>;
  /** Admit one automatic continuation round without changing the goal revision. */
  startRound(sessionId: SessionId, ref: GoalRef): Promise<GoalView>;
  /** Remove process-local continuation authority without changing durable state. */
  disarm(sessionId: SessionId): Promise<GoalView | undefined>;
}

export class GoalError extends Error {
  override readonly name = "GoalError";
  constructor(message: string, readonly code: string) { super(message); }
}
