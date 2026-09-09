import { isAbsolute, relative, resolve } from "node:path";
import {
  policyServiceToken,
  permissionPresetServiceToken,
  type SealHarnessEvents,
  type PolicyContext,
  type PolicyDecision,
  type PolicyService,
  type ToolPolicyAction,
  type ToolRisk,
  type PermissionPresetService,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export type PermissionMode = "read-only" | "workspace-write" | "danger-full-access";

export interface BasicPolicyConfig {
  readonly mode?: PermissionMode;
  readonly askFor?: readonly ToolRisk[];
  readonly allowReadOutsideWorkspace?: boolean;
}

export class BasicPolicyService implements PolicyService {
  readonly mode: PermissionMode;
  readonly askFor: ReadonlySet<ToolRisk>;

  constructor(readonly config: BasicPolicyConfig = {}, readonly permissions?: PermissionPresetService) {
    this.mode = config.mode ?? "workspace-write";
    this.askFor = new Set(config.askFor ?? ["external", "dangerous"]);
  }

  async decide(action: ToolPolicyAction, context: PolicyContext): Promise<PolicyDecision> {
    const preset = this.permissions === undefined ? undefined : this.permissions.resolve(await this.permissions.current(context.sessionId));
    const mode = preset?.sandbox ?? this.mode;
    const askFor = preset?.approval === "never" ? new Set<ToolRisk>() : this.askFor;
    if (mode === "danger-full-access") return { outcome: "allow" };
    if (action.risk === "read") {
      if (
        this.config.allowReadOutsideWorkspace !== true
        && action.target !== undefined
        && !isWithin(context.cwd, action.target)
      ) {
        return { outcome: "deny", reason: `Read target is outside the workspace: ${action.target}` };
      }
      return { outcome: "allow" };
    }

    if (mode === "read-only") {
      return { outcome: "deny", reason: `Permission mode read-only blocks ${action.risk}` };
    }

    if (action.risk === "workspace-write" && action.target !== undefined) {
      if (!isWithin(context.cwd, action.target)) {
        return {
          outcome: "deny",
          reason: `Target is outside the workspace: ${action.target}`,
        };
      }
    }

    if (askFor.has(action.risk)) {
      return { outcome: "ask", reason: action.summary };
    }
    return { outcome: "allow" };
  }
}

export const basicPolicyPlugin = definePlugin<BasicPolicyConfig, SealHarnessEvents>({
  name: "policy-basic",
  provides: [policyServiceToken],
  optional: [permissionPresetServiceToken],
  setup(context, config) {
    context.provide(policyServiceToken, new BasicPolicyService(config, context.has(permissionPresetServiceToken) ? context.use(permissionPresetServiceToken) : undefined));
  },
});

function isWithin(cwd: string, target: string): boolean {
  const root = resolve(cwd);
  const candidate = resolve(cwd, target);
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
