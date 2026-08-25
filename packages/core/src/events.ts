import type { SessionId } from "./ids.js";
import type { RuntimeEvent } from "./runtime.js";
import type { StoredSessionEvent } from "./session.js";
import type { ToolPolicyAction, ToolResult } from "./tool.js";
import type { PolicyDecision } from "./policy.js";

export interface PiHarnessEvents {
  "runtime.event": {
    readonly sessionId: SessionId;
    readonly event: RuntimeEvent;
  };
  "session.appended": {
    readonly sessionId: SessionId;
    readonly events: readonly StoredSessionEvent[];
  };
  "policy.decided": {
    readonly sessionId: SessionId;
    readonly action: ToolPolicyAction;
    readonly decision: PolicyDecision;
  };
  "tool.completed": {
    readonly sessionId: SessionId;
    readonly toolName: string;
    readonly result: ToolResult;
  };
}
