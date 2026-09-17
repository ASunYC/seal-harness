import type { SessionId } from "./ids.js";

export interface ReviewSnapshot {
  readonly id: string;
  readonly callId: string;
  readonly path: string;
  readonly createdAt: string;
  readonly status: "applied" | "conflict" | "rolled-back";
  readonly existed: boolean;
  readonly before: string | null;
  readonly after: string;
}
export interface ReviewService {
  read(sessionId: SessionId, snapshotId: string): Promise<ReviewSnapshot | undefined>;
  rollback?(sessionId: SessionId, snapshotId: string, cwd: string): Promise<"rolled-back" | "already-rolled-back" | "conflict" | "unavailable" | "busy">;
}
