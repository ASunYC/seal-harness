import { join } from "node:path";
import { agentCorePlugin } from "@seal-harness/agent-core";
import { localAttachmentPlugin } from "@seal-harness/attachment-local";
import { stdioApprovalPlugin } from "@seal-harness/approval-stdio";
import { contextCorePlugin } from "@seal-harness/context-core";
import { fileContextPlugin } from "@seal-harness/context-files";
import { windowCompactionPlugin } from "@seal-harness/compaction-window";
import { environmentCredentialPlugin } from "@seal-harness/credentials-env";
import {
  approvalServiceToken,
  type ApprovalService,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { defineProfile } from "@seal-harness/host";
import { definePlugin, plugin } from "@seal-harness/kernel";
import { basicPolicyPlugin } from "@seal-harness/policy-basic";
import { piAiProviderPlugin, type PiAiBuiltinProvider } from "@seal-harness/provider-pi-ai";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { jsonlSessionPlugin } from "@seal-harness/session-jsonl";
import { toolsCorePlugin } from "@seal-harness/tools-core";
import { noopTelemetryPlugin } from "@seal-harness/telemetry-noop";
import { workspaceToolsPlugin } from "@seal-harness/workspace-tools";

export interface DefaultProfileOptions {
  readonly cwd: string;
  readonly provider: PiAiBuiltinProvider;
  readonly providers?: readonly PiAiBuiltinProvider[];
  readonly approvalMode?: "ask" | "allow" | "deny";
  readonly approvalService?: ApprovalService;
  readonly credentialEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly enableShell?: boolean;
  readonly sessionRoot?: string;
  readonly attachmentRoot?: string;
}

export function createDefaultProfile(options: DefaultProfileOptions) {
  return defineProfile([
    plugin(noopTelemetryPlugin, undefined),
    plugin(environmentCredentialPlugin, {
      ...(options.credentialEnvironment === undefined
        ? {}
        : { environment: options.credentialEnvironment }),
    }),
    plugin(piAiProviderPlugin, { providers: options.providers ?? [options.provider] }),
    plugin(jsonlSessionPlugin, {
      root: options.sessionRoot ?? join(options.cwd, ".seal-harness", "sessions"),
    }),
    plugin(contextCorePlugin, {}),
    plugin(localAttachmentPlugin, {
      root: options.attachmentRoot ?? join(options.cwd, ".seal-harness", "attachments"),
    }),
    plugin(fileContextPlugin, {}),
    plugin(windowCompactionPlugin, {}),
    plugin(basicPolicyPlugin, { mode: "workspace-write" }),
    options.approvalService === undefined
      ? plugin(stdioApprovalPlugin, { mode: options.approvalMode ?? "ask" })
      : plugin(providedApprovalPlugin, { service: options.approvalService }),
    plugin(toolsCorePlugin, {}),
    plugin(workspaceToolsPlugin, { enableShell: options.enableShell ?? true }),
    plugin(piRuntimePlugin, {}),
    plugin(agentCorePlugin, {}),
  ]);
}

const providedApprovalPlugin = definePlugin<
  { readonly service: ApprovalService },
  SealHarnessEvents
>({
  name: "approval-provided",
  provides: [approvalServiceToken],
  setup(context, config) {
    context.provide(approvalServiceToken, config.service);
  },
});
