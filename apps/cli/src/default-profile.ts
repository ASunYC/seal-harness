import { join } from "node:path";
import { agentCorePlugin } from "@piharness/agent-core";
import { stdioApprovalPlugin } from "@piharness/approval-stdio";
import { fileContextPlugin } from "@piharness/context-files";
import { environmentCredentialPlugin } from "@piharness/credentials-env";
import { defineProfile } from "@piharness/host";
import { plugin } from "@piharness/kernel";
import { basicPolicyPlugin } from "@piharness/policy-basic";
import { piAiProviderPlugin, type PiAiBuiltinProvider } from "@piharness/provider-pi-ai";
import { piRuntimePlugin } from "@piharness/runtime-pi";
import { jsonlSessionPlugin } from "@piharness/session-jsonl";
import { toolsCorePlugin } from "@piharness/tools-core";
import { workspaceToolsPlugin } from "@piharness/workspace-tools";

export interface DefaultProfileOptions {
  readonly cwd: string;
  readonly provider: PiAiBuiltinProvider;
  readonly approvalMode?: "ask" | "allow" | "deny";
  readonly enableShell?: boolean;
  readonly sessionRoot?: string;
}

export function createDefaultProfile(options: DefaultProfileOptions) {
  return defineProfile([
    plugin(environmentCredentialPlugin, {}),
    plugin(piAiProviderPlugin, { providers: [options.provider] }),
    plugin(jsonlSessionPlugin, {
      root: options.sessionRoot ?? join(options.cwd, ".piharness", "sessions"),
    }),
    plugin(fileContextPlugin, {}),
    plugin(basicPolicyPlugin, { mode: "workspace-write" }),
    plugin(stdioApprovalPlugin, { mode: options.approvalMode ?? "ask" }),
    plugin(toolsCorePlugin, {}),
    plugin(workspaceToolsPlugin, { enableShell: options.enableShell ?? true }),
    plugin(piRuntimePlugin, {}),
    plugin(agentCorePlugin, {}),
  ]);
}
