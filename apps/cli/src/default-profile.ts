import { join } from "node:path";
import { agentCorePlugin } from "@seal-harness/agent-core";
import { agentPresetsPlugin } from "@seal-harness/agent-presets";
import { localAttachmentPlugin } from "@seal-harness/attachment-local";
import { stdioApprovalPlugin } from "@seal-harness/approval-stdio";
import { contextCorePlugin } from "@seal-harness/context-core";
import { fileContextPlugin } from "@seal-harness/context-files";
import { llmCompactionPlugin } from "@seal-harness/compaction-llm";
import { environmentCredentialPlugin } from "@seal-harness/credentials-env";
import {
  approvalServiceToken,
  type ApprovalService,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { defineProfile } from "@seal-harness/host";
import { definePlugin, plugin } from "@seal-harness/kernel";
import { basicPolicyPlugin } from "@seal-harness/policy-basic";
import {
  piAiProviderPlugin,
  type PiAiBuiltinProvider,
  type PiAiCustomProvider,
} from "@seal-harness/provider-pi-ai";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { jsonlSessionPlugin } from "@seal-harness/session-jsonl";
import { sessionQueryToolsPlugin } from "@seal-harness/session-query-tools";
import { localJobsPlugin } from "@seal-harness/jobs-local";
import { goalToolsPlugin } from "@seal-harness/goal-tools";
import { goalRoundDriverPlugin } from "@seal-harness/goal-round-driver";
import { todoToolsPlugin } from "@seal-harness/todo-tools";
import { planModePlugin } from "@seal-harness/plan-mode";
import { localSandboxPlugin } from "@seal-harness/sandbox-local";
import { scheduleToolsPlugin } from "@seal-harness/schedule-tools";
import { subagentToolsPlugin } from "@seal-harness/subagent-tools";
import { agentTeamPlugin } from "@seal-harness/agent-team";
import { agentTeamToolsPlugin } from "@seal-harness/agent-team-tools";
import { terminalPtyPlugin } from "@seal-harness/terminal-pty";
import { toolsCorePlugin } from "@seal-harness/tools-core";
import { localSpillPlugin } from "@seal-harness/spill-local";
import { fileSettingsPlugin } from "@seal-harness/settings-file";
import { noopTelemetryPlugin } from "@seal-harness/telemetry-noop";
import { workspaceToolsPlugin } from "@seal-harness/workspace-tools";
import { workflowToolsPlugin } from "@seal-harness/workflow-tools";
import { lspCorePlugin } from "@seal-harness/lsp-core";
import { lspStdioPlugin, type LspStdioConfig } from "@seal-harness/lsp-stdio";
import { lspToolsPlugin } from "@seal-harness/lsp-tools";
import { webCorePlugin } from "@seal-harness/web-core";
import { httpWebFetchPlugin, type HttpWebFetchConfig } from "@seal-harness/web-fetch-http";
import { exaWebSearchPlugin, type ExaWebSearchConfig } from "@seal-harness/web-search-exa";
import { webToolsPlugin, type WebToolsConfig } from "@seal-harness/web-tools";
import { userQuestionsPlugin } from "@seal-harness/user-questions";
import { askUserToolPlugin } from "@seal-harness/ask-user-tool";
import { commandsPlugin } from "@seal-harness/commands";
import { feedbackToolsPlugin } from "@seal-harness/feedback-tools";
import { permissionPresetsPlugin } from "@seal-harness/permission-presets";
import type { UserQuestionAnswerer } from "@seal-harness/core";

export interface DefaultProfileOptions {
  readonly cwd: string;
  readonly provider: PiAiBuiltinProvider;
  readonly providers?: readonly PiAiBuiltinProvider[];
  readonly customProviders?: readonly PiAiCustomProvider[];
  readonly approvalMode?: "ask" | "allow" | "deny";
  readonly approvalService?: ApprovalService;
  readonly credentialEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly enableShell?: boolean;
  readonly sessionRoot?: string;
  readonly attachmentRoot?: string;
  readonly lspServers?: LspStdioConfig["servers"];
  readonly webFetch?: HttpWebFetchConfig | false;
  readonly webSearchExa?: ExaWebSearchConfig;
  readonly webTools?: WebToolsConfig;
  readonly questionAnswerer?: UserQuestionAnswerer;
}

export function createDefaultProfile(options: DefaultProfileOptions) {
  return defineProfile([
    plugin(noopTelemetryPlugin, undefined),
    plugin(environmentCredentialPlugin, {
      path: join(options.cwd, ".seal-harness", "credentials.json"),
      ...(options.credentialEnvironment === undefined
        ? {}
        : { environment: options.credentialEnvironment }),
    }),
    plugin(piAiProviderPlugin, {
      providers: options.providers ?? [options.provider],
      ...(options.customProviders === undefined ? {} : { customProviders: options.customProviders }),
    }),
    plugin(jsonlSessionPlugin, {
      root: options.sessionRoot ?? join(options.cwd, ".seal-harness", "sessions"),
    }),
    plugin(fileSettingsPlugin, { path: join(options.cwd, ".seal-harness", "settings.yaml") }),
    plugin(contextCorePlugin, {}),
    plugin(localAttachmentPlugin, {
      root: options.attachmentRoot ?? join(options.cwd, ".seal-harness", "attachments"),
    }),
    plugin(fileContextPlugin, {}),
    plugin(llmCompactionPlugin, {}),
    plugin(commandsPlugin, undefined),
    plugin(permissionPresetsPlugin, {}),
    plugin(basicPolicyPlugin, { mode: "workspace-write" }),
    plugin(localSandboxPlugin, {}),
    options.approvalService === undefined
      ? plugin(stdioApprovalPlugin, { mode: options.approvalMode ?? "ask" })
      : plugin(providedApprovalPlugin, { service: options.approvalService }),
    plugin(localSpillPlugin, { root: join(options.cwd, ".seal-harness", "spill") }),
    plugin(toolsCorePlugin, {}),
    plugin(feedbackToolsPlugin, { root: join(options.cwd, ".seal-harness", "feedback") }),
    plugin(userQuestionsPlugin, options.questionAnswerer === undefined ? {} : { answerer: options.questionAnswerer }),
    plugin(askUserToolPlugin, undefined),
    plugin(sessionQueryToolsPlugin, {}),
    plugin(goalToolsPlugin, {}),
    plugin(goalRoundDriverPlugin, {}),
    plugin(todoToolsPlugin, { allowParallelInProgress: true }),
    plugin(planModePlugin, { section: "You are in plan mode. Explore the codebase and resolve important uncertainties before proposing an implementation. Do not modify files or execute the plan yet. When the plan is complete, call exit_plan_mode with the full markdown plan for user review." }),
    plugin(localJobsPlugin, {}),
    plugin(terminalPtyPlugin, {}),
    plugin(workspaceToolsPlugin, { enableShell: options.enableShell ?? true }),
    plugin(webCorePlugin, {}),
    ...(options.webFetch === false ? [] : [plugin(httpWebFetchPlugin, options.webFetch ?? {})]),
    ...(options.webSearchExa === undefined ? [] : [plugin(exaWebSearchPlugin, options.webSearchExa)]),
    plugin(webToolsPlugin, options.webTools ?? {}),
    plugin(agentPresetsPlugin, {}),
    plugin(piRuntimePlugin, {}),
    plugin(agentCorePlugin, {}),
    plugin(scheduleToolsPlugin, {}),
    plugin(subagentToolsPlugin, { registerTools: false }),
    plugin(agentTeamPlugin, {}),
    plugin(agentTeamToolsPlugin, {}),
    plugin(workflowToolsPlugin, {}),
    ...(options.lspServers === undefined ? [] : [
      plugin(lspCorePlugin, undefined),
      plugin(lspStdioPlugin, { servers: options.lspServers }),
      plugin(lspToolsPlugin, {}),
    ]),
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
