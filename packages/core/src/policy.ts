import type { SessionId } from "./ids.js";
import type { JsonObject } from "./json.js";
import type { ToolPolicyAction } from "./tool.js";

export interface PolicyContext {
  readonly sessionId: SessionId;
  readonly cwd: string;
}

export type PolicyDecision =
  | { readonly outcome: "allow"; readonly reason?: string }
  | { readonly outcome: "deny"; readonly reason: string }
  | { readonly outcome: "ask"; readonly reason: string; readonly details?: JsonObject };

export interface PolicyService {
  decide(action: ToolPolicyAction, context: PolicyContext): Promise<PolicyDecision>;
}

export interface ApprovalRequest {
  readonly title: string;
  readonly message: string;
  readonly details?: JsonObject;
  readonly signal: AbortSignal;
}

export interface ApprovalService {
  request(request: ApprovalRequest): Promise<boolean>;
}
