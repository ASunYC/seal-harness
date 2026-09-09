import type { SessionId } from "./ids.js";
import type { SessionSnapshot } from "./session.js";
import type { SandboxMode } from "./sandbox.js";

export type ApprovalPolicy = "ask" | "never";
export interface PermissionPresetSpec { readonly sandbox: SandboxMode; readonly approval: ApprovalPolicy; readonly name?: string; readonly description?: string }
export interface PermissionPresetOption { readonly value: string; readonly name: string; readonly description?: string }
export interface PermissionSelect { readonly options: readonly PermissionPresetOption[]; readonly currentValue: string }
export interface PermissionPresetService {
  readonly names: readonly string[];
  readonly defaultPreset: string;
  current(sessionId: SessionId): Promise<string>;
  select(sessionId: SessionId): Promise<PermissionSelect>;
  resolve(name: string): PermissionPresetSpec;
  sandboxMode(sessionId: SessionId): SandboxMode;
  set(sessionId: SessionId, name: string): Promise<string>;
  initialize(session: SessionSnapshot): Promise<SessionSnapshot>;
}
