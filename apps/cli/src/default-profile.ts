import { join } from "node:path";
import { agentCorePlugin } from "@piharness/agent-core";
import { localAttachmentPlugin } from "@piharness/attachment-local";
import { stdioApprovalPlugin } from "@piharness/approval-stdio";
import { contextCorePlugin } from "@piharness/context-core";
import { fileContextPlugin } from "@piharness/context-files";
import { windowCompactionPlugin } from "@piharness/compaction-window";
import { environmentCredentialPlugin } from "@piharness/credentials-env";
import { defineProfile } from "@piharness/host";
import { plugin } from "@piharness/kernel";
import { basicPolicyPlugin } from "@piharness/policy-basic";
import { piAiProviderPlugin, type PiAiBuiltinProvider } from "@piharness/provider-pi-ai";
import { piRuntimePlugin } from "@piharness/runtime-pi";
import { jsonlSessionPlugin } from "@piharness/session-jsonl";
import { toolsCorePlugin } from "@piharness/tools-core";
import { noopTelemetryPlugin } from "@piharness/telemetry-noop";
import { workspaceToolsPlugin } from "@piharness/workspace-tools";

export interface DefaultProfileOptions {
  readonly cwd: string;
  readonly provider: PiAiBuiltinProvider;
  readonly approvalMode?: "ask" | "allow" | "deny";
  readonly enableShell?: boolean;
  readonly sessionRoot?: string;
  readonly attachmentRoot?: string;
}

export function createDefaultProfile(options: DefaultProfileOptions) {
  return defineProfile([
    plugin(noopTelemetryPlugin, undefined),
    plugin(environmentCredentialPlugin, {}),
    plugin(piAiProviderPlugin, { providers: [options.provider] }),
    plugin(jsonlSessionPlugin, {
      root: options.sessionRoot ?? join(options.cwd, ".piharness", "sessions"),
    }),
    plugin(contextCorePlugin, {}),
    plugin(localAttachmentPlugin, {
      root: options.attachmentRoot ?? join(options.cwd, ".piharness", "attachments"),
    }),
    plugin(fileContextPlugin, {}),
    plugin(windowCompactionPlugin, {}),
    plugin(basicPolicyPlugin, { mode: "workspace-write" }),
    plugin(stdioApprovalPlugin, { mode: options.approvalMode ?? "ask" }),
    plugin(toolsCorePlugin, {}),
    plugin(workspaceToolsPlugin, { enableShell: options.enableShell ?? true }),
    plugin(piRuntimePlugin, {}),
    plugin(agentCorePlugin, {}),
  ]);
}
