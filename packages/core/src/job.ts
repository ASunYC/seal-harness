import type { SessionId } from "./ids.js";

export type JobStatus = "running" | "stopping" | "completed" | "failed" | "cancelled";

export interface JobOutcome {
  readonly status: "completed" | "failed" | "cancelled";
  readonly detail?: string;
}

export interface JobHooks {
  cancel(reason?: string): void;
  readonly done: Promise<JobOutcome>;
  readOutput?(): string;
}

export interface JobStart {
  readonly kind: string;
  readonly label: string;
  readonly ownerSession?: SessionId;
  readonly outputLimitBytes?: number;
  run(): JobHooks;
}

export interface JobSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly ownerSession?: SessionId;
  readonly status: JobStatus;
  readonly detail?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

export interface JobRead {
  readonly job: JobSnapshot;
  readonly output: string;
}

/** Process-local registry for cancellable background work owned by Sessions. */
export interface JobService {
  start(spec: JobStart): string;
  list(ownerSession?: SessionId): readonly JobSnapshot[];
  get(id: string, ownerSession?: SessionId): JobSnapshot;
  read(id: string, ownerSession?: SessionId): JobRead;
  wait(id: string, timeoutMs: number, ownerSession?: SessionId, signal?: AbortSignal): Promise<JobSnapshot>;
  cancel(id: string, ownerSession?: SessionId, reason?: string): JobSnapshot;
  /** Subscribe to owner-scoped snapshot changes when the implementation supports live control views. */
  subscribe?(listener: (ownerSession: SessionId | undefined) => void): () => void;
}
