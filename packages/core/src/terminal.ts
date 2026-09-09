import type { SessionId } from "./ids.js";
import type { SandboxEnforcement, SandboxMode } from "./sandbox.js";

export type TerminalStatus = "running" | "exited";

export interface TerminalSnapshot {
  readonly id: string;
  readonly ownerSession: SessionId;
  readonly cwd: string;
  readonly pid: number;
  readonly status: TerminalStatus;
  readonly exitCode?: number;
  readonly signal?: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly jobId: string;
  readonly sandbox?: { readonly mode: SandboxMode; readonly enforcement?: SandboxEnforcement };
}

export interface OpenTerminalRequest {
  readonly ownerSession: SessionId;
  readonly cwd: string;
  readonly command?: string;
  readonly cols?: number;
  readonly rows?: number;
}

export interface TerminalRead {
  readonly terminal: TerminalSnapshot;
  readonly output: string;
}

/** Persistent PTY sessions with Session-scoped ownership. */
export interface TerminalService {
  open(request: OpenTerminalRequest): TerminalSnapshot;
  list(ownerSession: SessionId): readonly TerminalSnapshot[];
  get(id: string, ownerSession: SessionId): TerminalSnapshot;
  write(id: string, ownerSession: SessionId, data: string): TerminalSnapshot;
  read(id: string, ownerSession: SessionId): TerminalRead;
  close(id: string, ownerSession: SessionId): TerminalSnapshot;
}
