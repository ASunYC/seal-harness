import type { SessionId } from "./ids.js";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ConfinedSandboxMode = Exclude<SandboxMode, "danger-full-access">;
export type SandboxEnforcement = "full" | "partial";
export interface SandboxExecutionPolicy { readonly mode: SandboxMode; readonly workspaceRoot: string; readonly sessionId?: SessionId; }
export interface SandboxPolicy extends SandboxExecutionPolicy { readonly mode: ConfinedSandboxMode; }
export interface ConfinedArgv { readonly argv: readonly string[]; readonly enforcement: SandboxEnforcement; readonly denialSignatures: readonly string[]; readonly runnerFailureSignatures: readonly string[]; }
export interface SandboxService { confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv; }
export class SandboxUnavailableError extends Error { override readonly name = "SandboxUnavailableError"; readonly code = "SANDBOX_UNAVAILABLE"; constructor(mode: ConfinedSandboxMode, detail?: string) { super(`sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; refusing to run unconfined${detail ? `: ${detail}` : ""}`); } }
