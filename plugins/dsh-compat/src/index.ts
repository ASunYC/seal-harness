import {
  Context as CordisContext,
  Service as CordisService,
  type Fiber as CordisFiber,
  type Plugin as CordisPlugin,
} from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Group from "@deepseek-ai/cordis-plugin-group";
import Hmr from "@deepseek-ai/cordis-plugin-hmr";
import Timer from "@deepseek-ai/cordis-plugin-timer";
import CodeRuntimeWorkerThread from "@deepseek-ai/dsh-code-runtime-worker-thread";
import Storage, { storageBackendServiceKey } from "@deepseek-ai/dsh-storage";
import * as StorageDomain from "@deepseek-ai/dsh-storage-domain";
import * as StorageJson from "@deepseek-ai/dsh-storage-json";
import * as StorageSqlite from "@deepseek-ai/dsh-storage-sqlite";
import { createScope as createDshScope, scopeChainOf as dshScopeChainOf, scopeOf as dshScopeOf } from "@deepseek-ai/dsh-scope";
import { renderToolsSdk } from "@deepseek-ai/dsh-tools";
import { agentEvents } from "@deepseek-ai/dsh-agent";
import DshAgentDefaultModel from "@deepseek-ai/dsh-agent-default-model";
import DshAgentPresets from "@deepseek-ai/dsh-agent-presets";
import "@deepseek-ai/dsh-agent-tool-presentation";
import DshSessionStore, { SessionForkError, SessionPreparation as DshSessionPreparation } from "@deepseek-ai/dsh-session";
import DshSystemPrompt, { renderContextSections, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import DshSessionProjections from "@deepseek-ai/dsh-session-projection";
import DshSessionProjectionCache from "@deepseek-ai/dsh-session-projection-cache";
import DshJsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import DshSessionQuery from "@deepseek-ai/dsh-session-query";
import DshSqliteSessionQuery from "@deepseek-ai/dsh-session-query-sqlite";
import DshSessionTitle from "@deepseek-ai/dsh-session-title";
import * as DshSessionStats from "@deepseek-ai/dsh-session-stats";
import * as DshSessionTurnOutline from "@deepseek-ai/dsh-session-turn-outline";
import * as DshSessionCheckpointPolicy from "@deepseek-ai/dsh-session-checkpoint-policy";
import * as DshSessionTitleFirstPromptLlm from "@deepseek-ai/dsh-session-title-first-prompt-llm";
import * as DshSessionTitleAllPromptsLlm from "@deepseek-ai/dsh-session-title-all-prompts-llm";
import DshSubagentRuntime from "@deepseek-ai/dsh-subagent";
import * as DshSubagentAcp from "@deepseek-ai/dsh-subagent-acp";
import * as DshSubagentForkInProcess from "@deepseek-ai/dsh-subagent-fork-in-process";
import * as DshSubagentSpawnInProcess from "@deepseek-ai/dsh-subagent-spawn-in-process";
import * as DshToolSubagent from "@deepseek-ai/dsh-tool-subagent";
import DshSubagentModelSelectionConfig from "@deepseek-ai/dsh-tool-subagent/model-selection-settings";
import * as DshToolSubagentControl from "@deepseek-ai/dsh-tool-subagent-control";
import * as DshToolSubagentListAgents from "@deepseek-ai/dsh-tool-subagent-control/list-agents";
import DshInvariantRegistry from "@deepseek-ai/dsh-invariants";
import DshSandboxProvider from "@deepseek-ai/dsh-sandbox";
import DshLocalSandboxProvider, { type Config as DshLocalSandboxConfig } from "@deepseek-ai/dsh-sandbox-local";
import DshCredentialProvider from "@deepseek-ai/dsh-credentials";
import DshLocalCredentialProvider from "@deepseek-ai/dsh-credentials-local";
import { canExecute, hasLinuxChooserBinary, resolveDirectoryPickerBackend } from "@deepseek-ai/dsh-host-directory-picker-auto";
import DshApprovalService from "@deepseek-ai/dsh-user-approval";
import DshUserQuestionService from "@deepseek-ai/dsh-user-questions";
import * as DshToolAskUser from "@deepseek-ai/dsh-tool-ask-user";
import DshGoalService from "@deepseek-ai/dsh-goal";
import DshTokenMeter from "@deepseek-ai/dsh-token-meter";
import DshBasicCompaction from "@deepseek-ai/dsh-compaction-basic";
import DshToolResultPruner from "@deepseek-ai/dsh-compaction-tool-result-pruner";
import DshCordisHostRunner from "@deepseek-ai/dsh-cordis-host-runner";
import * as DshToolCordis from "@deepseek-ai/dsh-tool-cordis";
import DshCommandRuntime from "@deepseek-ai/dsh-commands";
import * as DshCommandCompact from "@deepseek-ai/dsh-command-compact";
import * as DshCommandFeedback from "@deepseek-ai/dsh-command-feedback";
import * as DshCommandGoal from "@deepseek-ai/dsh-command-goal";
import DshMessageFeedback from "@deepseek-ai/dsh-message-feedback";
import * as DshSessionLogExport from "@deepseek-ai/dsh-session-log-export";
import * as DshSessionLogDeepSeek from "@deepseek-ai/dsh-session-log-deepseek";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import DshTypertRegistry from "@deepseek-ai/dsh-typert-registry";
import * as DshTypertLoader from "@deepseek-ai/dsh-typert-loader";
import DshTypertGateway from "@deepseek-ai/dsh-api-gateway";
import DshBrowseDirectoryPicker from "@deepseek-ai/dsh-host-directory-picker-browse";
import DshNativeDirectoryPicker from "@deepseek-ai/dsh-host-directory-picker-native";
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from "@deepseek-ai/dsh-launch-environment";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { AttachmentId as DshAttachmentId, AttachmentStore as DshAttachmentStore, ImageVariantId as DshImageVariantId, type ImageAttachmentRef as DshImageAttachmentRef, type ImageMediaType as DshImageMediaType, type ImageRequestPolicy as DshImageRequestPolicy, type SaveImageAttachment as DshSaveImageAttachment } from "@deepseek-ai/dsh-attachment";
import DshLocalAttachmentStore from "@deepseek-ai/dsh-attachment-local";
import DshAuthorization from "@deepseek-ai/dsh-authorization";
import { createHash } from "node:crypto";
import sharp from "sharp";
import DshLlmRuntime, { LlmAdapter as DshLlmAdapter, type GenerateOptions as DshGenerateOptions, type LlmModelInfo as DshModelInfo, type LlmResolvedModelInfo as DshResolvedModelInfo, type StreamChunk as DshStreamChunk } from "@deepseek-ai/dsh-llm";
import * as DshLlmDeepSeek from "@deepseek-ai/dsh-llm-deepseek";
import * as DshLlmPiAi from "@deepseek-ai/dsh-llm-pi-ai";
import DshDeepSeekLlmApiExtensions from "@deepseek-ai/dsh-deepseek-llm-api-extensions";
import * as DshPluginPackageInventoryDeepSeek from "@deepseek-ai/dsh-plugin-package-inventory-deepseek";
import * as DshLlmRetry from "@deepseek-ai/dsh-llm-retry";
import * as DshRepeatToolReminder from "@deepseek-ai/dsh-repeat-tool-reminder";
import * as DshAgentInstructions from "@deepseek-ai/dsh-agent-instructions";
import DshLocalFileSystem from "@deepseek-ai/dsh-fs-local";
import DshSandboxedFileSystem from "@deepseek-ai/dsh-fs-sandbox";
import * as DshFileSystemObservationPolicy from "@deepseek-ai/dsh-fs-observation-policy";
import * as DshToolFileSystem from "@deepseek-ai/dsh-tool-fs";
import * as DshToolStrReplaceEditor from "@deepseek-ai/dsh-tool-str-replace-editor";
import DshLocalSubprocess from "@deepseek-ai/dsh-subprocess-local";
import DshE2BRuntime from "@deepseek-ai/dsh-e2b";
import DshE2BFileSystem from "@deepseek-ai/dsh-fs-e2b";
import DshE2BSubprocess from "@deepseek-ai/dsh-subprocess-e2b";
import * as DshShellEnv from "@deepseek-ai/dsh-shell-env";
import DshPwshLocal from "@deepseek-ai/dsh-pwsh-local";
import DshBashLocal from "@deepseek-ai/dsh-bash-local";
import DshBashSandbox from "@deepseek-ai/dsh-bash-sandbox";
import * as DshToolPwsh from "@deepseek-ai/dsh-tool-pwsh";
import * as DshToolBash from "@deepseek-ai/dsh-tool-bash";
import * as DshToolPwshPersistent from "@deepseek-ai/dsh-tool-pwsh-persistent";
import * as DshToolFileSearch from "@deepseek-ai/dsh-tool-fs-search";
import DshJobRegistry, { JobId as DshJobId, type JobSnapshot as DshJobSnapshot } from "@deepseek-ai/dsh-jobs";
import DshLocalJobRegistry from "@deepseek-ai/dsh-jobs-local";
import * as DshToolTodo from "@deepseek-ai/dsh-tool-todo";
import DshPlanMode from "@deepseek-ai/dsh-plan-mode";
import DshSandboxPolicy from "@deepseek-ai/dsh-sandbox-policy";
import DshPwshSandbox from "@deepseek-ai/dsh-pwsh-sandbox";
import DshPermissionPresets from "@deepseek-ai/dsh-permission-presets";
import DshFileSettings from "@deepseek-ai/dsh-settings-file";
import DshSettingsController from "@deepseek-ai/dsh-api-settings-controller";
import * as DshUiSettingsGeneralHost from "@deepseek-ai/dsh-client-ui-settings-general";
import DshSessionController from "@deepseek-ai/dsh-api-session-controller";
import DshWorkspaceController from "@deepseek-ai/dsh-api-workspace-controller";
import DshPluginInventory from "@deepseek-ai/dsh-host-plugin-inventory";
import DshSkillRegistry from "@deepseek-ai/dsh-skill";
import * as DshSkillBadge from "@deepseek-ai/dsh-skill-badge";
import * as DshSkillFilesystem from "@deepseek-ai/dsh-skill-filesystem";
import * as DshToolSkill from "@deepseek-ai/dsh-tool-skill";
import * as DshToolCallTimeoutPolicy from "@deepseek-ai/dsh-tool-call-timeout-policy";
import DshLocalSpillStore from "@deepseek-ai/dsh-spill-local";
import * as DshSpillPolicy from "@deepseek-ai/dsh-spill-policy";
import DshWorkflowWorkerThread from "@deepseek-ai/dsh-workflow-worker-thread";
import * as DshToolWorkflow from "@deepseek-ai/dsh-tool-workflow";
import * as DshToolRalph from "@deepseek-ai/dsh-tool-ralph";
import * as DshGoalRoundDriver from "@deepseek-ai/dsh-goal-round-driver";
import * as DshToolGoal from "@deepseek-ai/dsh-tool-goal";
import * as DshHooksClaudeCode from "@deepseek-ai/dsh-hooks-claude-code";
import * as DshHooksCodex from "@deepseek-ai/dsh-hooks-codex";
import * as DshTimeContext from "@deepseek-ai/dsh-time-context";
import DshSessionReference from "@deepseek-ai/dsh-session-reference";
import DshTerminalSessionService from "@deepseek-ai/dsh-terminal";
import * as DshTerminalBash from "@deepseek-ai/dsh-terminal-bash";
import * as DshToolTerminal from "@deepseek-ai/dsh-tool-terminal";
import DshLsp, { LspError as DshLspError, type LspProvider as DshLspProvider, type LspQueryRequest as DshLspQueryRequest, type LspQueryResult as DshLspQueryResult } from "@deepseek-ai/dsh-lsp";
import * as DshLspStdio from "@deepseek-ai/dsh-lsp-stdio";
import * as DshToolLsp from "@deepseek-ai/dsh-tool-lsp";
import * as DshSchedule from "@deepseek-ai/dsh-schedule";
import * as DshMcpClient from "@deepseek-ai/dsh-mcp-client";
import DshWebRuntime from "@deepseek-ai/dsh-web";
import * as DshWebFetchHttp from "@deepseek-ai/dsh-web-fetch-http";
import * as DshWebSearchDeepSeek from "@deepseek-ai/dsh-web-search-deepseek";
import * as DshWebSearchExa from "@deepseek-ai/dsh-web-search-exa";
import * as DshWebSearchPerplexity from "@deepseek-ai/dsh-web-search-perplexity";
import * as DshToolWeb from "@deepseek-ai/dsh-tool-web";
import * as DshToolJobs from "@deepseek-ai/dsh-tool-jobs";
import * as DshToolSessionQuery from "@deepseek-ai/dsh-tool-session-query";
import DshOpenTelemetrySessionBackend, { SessionTelemetryMode as DshSessionTelemetryMode } from "@deepseek-ai/dsh-session-telemetry-otel";
import DshLocalFileReferenceService from "@deepseek-ai/dsh-file-reference-local";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  text,
  sessionId,
  turnId,
  toolCallId,
  messageId,
  modelServiceToken,
  attachmentServiceToken,
  sandboxServiceToken,
  credentialServiceToken,
  approvalServiceToken,
  userQuestionServiceToken,
  jobServiceToken,
  settingsServiceToken,
  messageFeedbackServiceToken,
  lspServiceToken,
  agentPresetServiceToken,
  subagentServiceToken,
  foldSessionInbox,
  agentServiceToken,
  contextServiceToken,
  sessionStoreToken,
  SessionConflictError,
  toolServiceToken,
  type ContentBlock,
  type AgentService,
  type ContextService,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type ModelInfo,
  type ModelService,
  type AttachmentService,
  type SandboxService,
  type CredentialService,
  type ApprovalService,
  type UserQuestionService,
  type JobService,
  type SettingsService,
  MessageFeedbackError,
  type MessageFeedbackItem,
  type MessageFeedbackService,
  type LspService,
  type AgentPresetRow,
  type AgentPresetService,
  type SubagentService,
  type SealHarnessEvents,
  type SessionStore,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
  type ToolRisk,
  type ToolService,
  type UserMessage,
} from "@seal-harness/core";
import { createServiceToken, definePlugin } from "@seal-harness/kernel";

export type DshPlugin = CordisPlugin;

const DEFAULT_PLAN_MODE_SECTION = `You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. Conversational agreement does not approve or end plan mode; fold confirmed decisions into the plan and submit it through exit_plan_mode.

Explore first using non-mutating reads, searches, static analysis, and checks. Do not edit files, change configuration, run rewriting generators or formatters, commit, or otherwise carry out the plan. The tool catalog stays stable, but these rules override mutation-tool guidance. Do not use todo_write for the planning phase.

Resolve discoverable facts by inspection and ask the user only for user-owned choices or material ambiguity. Make the plan decision-complete: include the goal, success criteria, subsystem changes, public API/schema/data-flow effects, edge cases, failure modes, tests, acceptance criteria, and explicit assumptions.

When ready, call exit_plan_mode with the complete markdown plan starting with a # title, as the only and final tool call in that response. If review rejects it, incorporate the feedback and present it again. If review is unavailable or aborted, stay in plan mode and ask the user to switch modes manually.`;

export interface DshPluginModule {
  readonly default?: DshPlugin;
  readonly name?: string;
  readonly inject?: unknown;
  readonly Config?: unknown;
  // `any` is intentional: imported DSH modules expose their own config type.
  apply?(context: CordisContext, config: any): unknown;
}

export type DshPluginSource = DshPlugin | DshPluginModule;

export interface DshPluginSpec {
  readonly plugin: DshPluginSource;
  readonly config?: unknown;
  readonly enabled?: boolean;
}

export interface DshCompatConfig {
  readonly plugins?: readonly DshPluginSpec[];
  /** Optional Cordis configuration tree loaded with the official Loader. */
  readonly configFile?: string;
  /** Official generated Typert schema/reflection registry. */
  readonly typert?: false;
  /** Automatic Typert artifact discovery for Loader packages. */
  readonly typertLoader?: false | { readonly packages?: readonly string[] };
  /** Official local Typert Remote dispatcher when the Host supplies no gateway. */
  readonly typertGateway?: false | { readonly websocketHeartbeatIntervalMs?: number };
  /** Official browse-capable directory picker for Web hosts. */
  readonly directoryPicker?: false | { readonly backend?: "auto" | "browse" | "native"; readonly maxEntries?: number };
  /** Opt-in official Cordis module/config hot replacement for a loaded config tree. */
  readonly hmr?: {
    readonly roots?: readonly string[];
    readonly ignored?: readonly string[];
    readonly debounceMs?: number;
  };
  /** Official file-backed settings, sharing Seal's documentPath when available. */
  readonly settingsFile?: false | {
    readonly path?: string;
    readonly dshHome?: string;
    readonly watch?: boolean;
    readonly debounceMs?: number;
  };
  /** Additional named Cordis services made available to DSH `inject` declarations. */
  readonly services?: Readonly<Record<string, unknown>>;
  /** Immutable launch-time environment provenance. Process values are always the highest-priority layer. */
  readonly launchEnvironment?: false | {
    readonly project?: { readonly path: string; readonly values: Readonly<Record<string, string>> };
    readonly user?: { readonly path: string; readonly values: Readonly<Record<string, string>> };
  };
  /** Official deployment-wide system-prompt identity, persona, and tool ordering. */
  readonly systemPrompt?: {
    /** @deprecated Retained for config compatibility; Seal always owns harness identity. */
    readonly includeHarnessIdentity?: boolean;
    readonly includeRuntimeContext?: boolean;
    readonly persona?: string;
    readonly toolOrder?: readonly string[];
  };
  /** Maximum time to wait for initial Cordis plugin loading work to settle. */
  readonly startupTimeoutMs?: number;
  /** Conservative risk assigned to bridged DSH tools unless overridden by name. */
  readonly defaultToolRisk?: ToolRisk;
  readonly toolRisks?: Readonly<Record<string, ToolRisk>>;
  /** DSH tool presentation: native calls, run_code only, or both. */
  readonly toolPresentation?: "native" | "ptc" | "both";
  readonly maxParallelCodeCalls?: number;
  /** Official isolated TypeScript Code Runtime. Enabled by default; false disables it. */
  readonly codeRuntime?: false | {
    readonly computeMs?: number;
    readonly maxWallMs?: number;
    readonly maxOutputBytes?: number;
    readonly maxOldGenerationSizeMb?: number;
  };
  /** Official Storage hub and domain form. Uses the JSON backend by default. */
  readonly storage?: false | {
    readonly backend?: "json" | "sqlite";
    readonly root?: string;
    readonly path?: string;
    readonly journalMode?: "wal" | "delete" | "truncate" | "persist";
    readonly routes?: Readonly<Record<string, string>>;
  };
  /** Official package-owned runtime invariant registry. Enabled by default. */
  readonly invariants?: false | {
    readonly enabled?: boolean;
    readonly package_allowlist?: readonly string[];
    readonly package_blocklist?: readonly string[];
  };
  /** Official DSH approval policy and audit service. */
  readonly approval?: false | { readonly policy?: "ask" | "never" };
  /** Official model-facing ask_user_question fallback when Seal has no native owner. */
  readonly askUserTool?: false;
  /** Official DSH durable goal lifecycle. Enabled by default. */
  readonly goals?: false | { readonly defaultMaxGoalRounds?: number };
  /** Official per-session standing agent compositions. Enabled when configured. */
  readonly agentPresets?: false | {
    readonly default: string;
    readonly roots?: readonly { readonly path: string; readonly trust?: "system" | "user" }[];
    readonly includeShippedRoot?: boolean;
    readonly includeUserRoot?: boolean;
  };
  /** Official model-facing goal tools when Seal does not already own their names. */
  readonly goalTools?: false | { readonly blockedAfterConsecutiveRounds?: number };
  /** Official event-sourced todo_write fallback when Seal has not registered that tool. */
  readonly todoTool?: false | { readonly allowParallelInProgress?: boolean };
  /** Official logged plan-mode fallback when Seal has not registered exit_plan_mode. */
  readonly planMode?: false | { readonly section?: string };
  /** Same-session automatic continuation for armed durable goals. */
  readonly goalRoundDriver?: false;
  /** Durable per-step wall-clock, elapsed-time, and browser-time-zone context. */
  readonly timeContext?: false | {
    readonly timeZone?: string;
    readonly refreshIntervalMs?: number;
  };
  /** Bounded, read-only snapshots of explicitly referenced Sessions. */
  readonly sessionReference?: false | {
    readonly maxReferences?: number;
    readonly candidateLimit?: number;
    readonly maxReferenceBytes?: number;
  };
  /** Official owner-scoped persistent PTY registry, local backend, and tools. */
  readonly terminal?: false | {
    readonly backendType?: string;
    readonly shellDialect?: "bash" | "pwsh";
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly rows?: number;
    readonly cols?: number;
    readonly scrollbackLines?: number;
    readonly scrollbackMaxBytes?: number;
    readonly maxReadBytes?: number;
    readonly pollIntervalMs?: number;
    readonly exactProbeAfterMs?: number;
    readonly idleSilenceMs?: number;
    readonly handoffGraceMs?: number;
    readonly timeoutMs?: number;
    readonly disposeGraceMs?: number;
    readonly tools?: false | { readonly enableRunInBackground?: boolean; readonly maxResultBytes?: number };
  };
  /** Official LSP seam over Seal's compatible service, plus the official model tool when available. */
  readonly lsp?: false | {
    readonly maxLocations?: number;
    readonly maxResultChars?: number;
    readonly timeoutMs?: number;
    readonly tools?: false;
    /** Explicit local language-server table; processes launch lazily on matching queries. */
    readonly stdio?: false | {
      readonly servers: Readonly<Record<string, {
        readonly command: string;
        readonly extensionToLanguage: Readonly<Record<string, string>>;
        readonly args?: readonly string[];
        readonly env?: Readonly<Record<string, string>>;
        readonly initializationOptions?: unknown;
        readonly configuration?: unknown;
        readonly maxMessageBytes?: number;
        readonly maxStderrBytes?: number;
        readonly maxDocumentBytes?: number;
        readonly shutdownTimeoutMs?: number;
        readonly killGraceMs?: number;
      }>>;
    };
  };
  /** Official per-root-Agent durable one-shot and fixed-rate reminders. */
  readonly schedule?: false;
  /** Official reconnecting MCP tool bridges. Omitted means no outbound MCP connections. */
  readonly mcp?: false | readonly (
    | {
        readonly transport: "stdio";
        readonly serverName: string;
        readonly command: string;
        readonly args?: readonly string[];
        readonly env?: Readonly<Record<string, string>>;
        readonly cwd?: string;
        readonly toolCallTimeoutMs?: number;
        readonly failOnStartupError?: boolean;
        readonly reconnect?: { readonly enabled?: boolean; readonly initialDelayMs?: number; readonly maxDelayMs?: number; readonly maxAttempts?: number };
      }
    | {
        readonly transport: "streamable-http";
        readonly serverName: string;
        readonly url: string;
        readonly headers?: Readonly<Record<string, string>>;
        readonly toolCallTimeoutMs?: number;
        readonly failOnStartupError?: boolean;
        readonly reconnect?: { readonly enabled?: boolean; readonly initialDelayMs?: number; readonly maxDelayMs?: number; readonly maxAttempts?: number };
      }
  )[];
  /** Official Web provider registry, anonymous HTTP fetch backend, and model tools. */
  readonly web?: false | {
    readonly searchProvider?: string;
    readonly fetchProvider?: string;
    /** DeepSeek search follows the DSH base default; additional backends remain opt-in. */
    readonly searchProviders?: {
      readonly deepseek?: false | {
        readonly apiKey?: string;
        readonly apiKeyEnv?: string;
        readonly baseURL?: string;
        readonly model?: string;
        readonly apiVersion?: string;
        readonly maxTokens?: number;
        readonly maxUses?: number;
      };
      readonly exa?: false | {
        readonly apiKey?: string;
        readonly baseURL?: string;
        readonly searchType?: "auto" | "keyword" | "neural";
        readonly numResults?: number;
        readonly highlightsPerResult?: number;
      };
      readonly perplexity?: false | {
        readonly apiKey?: string;
        readonly baseURL?: string;
        readonly model?: string;
        readonly maxTokens?: number;
        readonly searchRecency?: "day" | "week" | "month" | "year";
      };
    };
    readonly fetchHttp?: false | {
      readonly maxResponseBytes?: number;
      readonly maxBodyChars?: number;
      readonly timeoutMs?: number;
      readonly maxRedirects?: number;
      readonly userAgent?: string;
    };
    readonly tools?: false | {
      readonly search?: boolean;
      readonly fetch?: boolean;
      readonly searchMaxResults?: number;
      readonly searchMaxQueries?: number;
      readonly fetchTimeoutMs?: number;
      readonly searchTimeoutMs?: number;
      readonly fetchMaxOutputChars?: number;
    };
  };
  /** Official Session telemetry capture and OTLP/HTTP backend. Environment overrides match DSH; Seal keeps a local-only DISABLED fallback. */
  readonly sessionTelemetry?: false | {
    readonly mode?: "DISABLED" | "FEEDBACK_ONLY" | "FULL";
    readonly exporter?: Readonly<Record<string, unknown>>;
    readonly processor?: Readonly<Record<string, unknown>>;
    readonly shutdownTimeoutMillis?: number;
  };
  /** Official per-Agent local @path candidate discovery and prompt guidance. */
  readonly fileReferences?: false | {
    readonly maxResults?: number;
    readonly maxEntries?: number;
    readonly excludedDirectories?: readonly string[];
  };
  /** Official background-job inspection, output, cancellation, and completion delivery tools. */
  readonly jobTools?: false | {
    readonly waitTimeoutMs?: number;
    readonly maxWaitTimeoutMs?: number;
    readonly completionDelivery?: "quiet" | "wakeup";
    readonly maxConsecutiveWakes?: number;
  };
  /** Official process-local jobs provider used when Seal has no shared JobService. */
  readonly localJobs?: false | { readonly maxConcurrentJobsPerOwner?: number };
  /** Official cross-Session search, lineage, event trace, and exact-read tools. */
  readonly sessionQueryTools?: false | {
    readonly maxSearchResults?: number;
    readonly searchTimeoutMs?: number;
  };
  /** Official SQLite FTS5 session-query backend; standalone hosts default to the DSH-base in-memory, search-disabled mode. */
  readonly sessionQuerySqlite?: false | {
    readonly path: string;
    readonly openAt?: "startup" | "first-search" | "never";
    readonly journalMode?: "wal" | "delete" | "truncate" | "persist";
    readonly defaultLimit?: number;
    readonly maxLimit?: number;
    readonly snippetChars?: number;
    readonly readWindowMax?: number;
    readonly persistedReadConcurrency?: number;
    readonly preparedSessionCacheSize?: number;
  };
  /** Enable full-text search in the Seal-backed query bridge. Exact reads and observation remain available when disabled. */
  readonly sessionQuerySearch?: boolean;
  /** Official durable JSONL session backend; standalone hosts default to the DSH-base sessions root. */
  readonly sessionPersistenceJsonl?: false | {
    readonly root?: string;
    readonly packChunks?: boolean;
    readonly compression?: "zstd" | "none";
  };
  /** Official scoped human-command runtime. Enabled by default. */
  readonly commands?: false;
  /** Opt-in deployment-level durable ratings and notes for finalized assistant messages. */
  readonly messageFeedback?: false | { readonly maxNoteBytes?: number };
  /** Opt-in deployment-level Web /export command and authenticated Session archive route. */
  readonly sessionLogExport?: false | { readonly compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 };
  /** Replay-safe model-free pruning performed before summary compaction. */
  readonly toolResultPruner?: false | {
    readonly thresholdChars?: number;
    readonly headChars?: number;
    readonly tailChars?: number;
  };
  /** Log-backed session title projection and provider registry. */
  readonly sessionTitle?: false | {
    readonly fallbackMaxWords?: number;
    readonly fallbackMaxBytes?: number;
    readonly maxTitleBytes?: number;
    readonly llm?: false | {
      /** Recompute once from the first prompt, or after every human prompt. */
      readonly strategy?: "first-prompt" | "all-prompts";
      readonly targetWords?: number;
      readonly targetCjkCharacters?: number;
      readonly maxInputBytes?: number;
      readonly maxOutputTokens?: number;
      readonly timeoutMs?: number;
      readonly provider?: string;
      readonly model?: string;
    };
  };
  /** Whole-log turn, step, model, tool, TTFT, and decode projection. */
  readonly sessionStats?: false;
  /** Whole-log turn anchors and bounded prompt/response previews. */
  readonly sessionTurnOutline?: false;
  /** Fail-closed durability barriers before model requests and tool side effects. */
  readonly sessionCheckpointPolicy?: false;
  /** Durable, identity-bound write-behind cache for projection checkpoints. */
  readonly sessionProjectionCache?: false | {
    readonly writeEveryEvents?: number;
    readonly writeIntervalMs?: number;
  };
  /** Provider-owned retry policy executor and durable retry audit. */
  readonly llmRetry?: false;
  /** Official DeepSeek model provider with V4 discovery, reasoning, multimodal Files API, credentials, and retries. */
  readonly deepseekLlm?: false | DshLlmDeepSeek.Config;
  /** Opt-in official generic pi-ai adapter with live multi-provider profiles. */
  readonly piAiLlm?: false | DshLlmPiAi.Config;
  /** Registry for independently owned, transactionally accepted DeepSeek request fields. */
  readonly deepseekLlmApiExtensions?: false;
  /** Lossless incremental canonical Session log contribution to official DeepSeek requests. */
  readonly deepseekSessionLog?: false | DshSessionLogDeepSeek.Config;
  /** Loader-backed package provenance attached to official DeepSeek requests. */
  readonly deepseekPluginPackageInventory?: false | DshPluginPackageInventoryDeepSeek.Config;
  /** Opt-in owner-only YAML credential store used when Seal does not provide credentials. */
  readonly localCredentials?: false | {
    readonly path?: string;
    readonly dshHome?: string;
    readonly watch?: boolean;
    readonly debounceMs?: number;
  };
  /** Official interactive credential-acquisition flow registry. */
  readonly authorization?: false;
  /** Opt-in content-addressed local image store used when Seal does not provide attachments. */
  readonly localAttachments?: false | {
    readonly dshHome?: string;
    readonly maxImageBytes?: number;
    readonly maxImagesPerMessage?: number;
    readonly maxMessageImageBytes?: number;
    readonly maxImagePixels?: number;
    readonly maxImageDimension?: number;
    readonly normalizedImageMaxPixels?: number;
    readonly normalizedImageMaxDimension?: number;
    readonly normalizedImageMaxBytes?: number;
    readonly imageCompressionConcurrency?: number;
  };
  /** Read-only import of existing Claude Code or Codex hook configuration; hook commands run through the DSH shell. */
  readonly hooks?: false | {
    readonly claudeCode?: false | {
      readonly configPath: string;
      readonly pluginRoot?: string;
      readonly projectDir?: string;
      readonly defaultTimeoutMs?: number;
      readonly stderrSummaryMaxChars?: number;
    };
    readonly codex?: false | {
      readonly configPath: string;
      readonly model?: string;
      readonly defaultTimeoutMs?: number;
      readonly stderrSummaryMaxChars?: number;
    };
  };
  /** Native out-of-process coding-agent providers; processes start only when a subagent call selects one. */
  readonly externalSubagents?: false | {
    readonly acp?: false | {
      readonly providerName?: string;
      readonly command: string;
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly permission?: "allow" | "reject";
      readonly env?: Readonly<Record<string, string>>;
      readonly disposeEofGraceMs?: number;
      readonly disposeGraceMs?: number;
    };
    /** Legacy configuration is rejected: Seal does not launch a second coding-agent engine. */
    readonly claudeCode?: false | Readonly<Record<string, unknown>>;
    /** Legacy configuration is rejected: use Seal's PI-backed subagents instead. */
    readonly codex?: false | Readonly<Record<string, unknown>>;
  };
  /** Official same-process child providers: fresh spawn and completed-turn-prefix fork. */
  readonly inProcessSubagents?: false | {
    readonly spawn?: false | { readonly providerName?: string };
    readonly fork?: false | { readonly providerName?: string };
  };
  /** Default route for DSH Agents created without explicit model options. */
  readonly agentDefaultModel?: false | { readonly provider: string; readonly model: string };
  /** Advisory context injected when one Agent repeats an identical tool call. */
  readonly repeatToolReminder?: false | {
    readonly thresholds?: readonly number[];
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly argumentsPreviewChars?: number;
  };
  /** DSH filesystem capability used by instruction discovery and compatible plugins. */
  readonly fileSystem?: false | { readonly cwd?: string; readonly diffBasisMaxBytes?: number };
  /** Per-Agent read-before-edit and observed-version CAS policy for DSH filesystem mutations. */
  readonly fileSystemObservationPolicy?: false;
  /** Hierarchical AGENTS.md/CLAUDE.md workspace instruction projection. */
  readonly agentInstructions?: false | {
    readonly dshHome?: string;
    readonly projectRootMarkers?: readonly string[];
    readonly maxBytes?: number;
    readonly maxSourceBytes?: number;
    readonly instructionFileCandidates?: readonly string[];
    readonly localInstructionFileCandidates?: readonly string[];
  };
  /** Official model-facing read/write/edit/read_image tools over the DSH filesystem. */
  readonly fileSystemTools?: false | {
    readonly readLimit?: number;
    readonly readMaxLineLength?: number;
    readonly readMaxBytes?: number;
    readonly readStreamMinSize?: number;
  };
  /** Official all-in-one view/create/replace/insert editor over the DSH filesystem. */
  readonly strReplaceEditor?: false | { readonly maxOutputChars?: number; readonly description?: string };
  /** Official local subprocess seam and foreground PowerShell tool. */
  readonly powerShell?: false | {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly maxTimeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly maxSpillBytes?: number;
    readonly graceMs?: number;
    readonly pwshPath?: string;
  };
  /** Official Bash executor/tool on non-Windows hosts. */
  readonly bash?: false | {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly maxTimeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly maxSpillBytes?: number;
    readonly graceMs?: number;
    readonly enableRunInBackground?: boolean;
  };
  /** Explicit opt-in to one shared remote E2B Linux world for filesystem and subprocess operations. */
  readonly e2b?: false | {
    readonly apiKey?: string;
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly fileSystem?: boolean;
    readonly subprocess?: false | { readonly pollMs?: number };
  };
  /** Replace the foreground pwsh tool with one owner-scoped persistent PowerShell shell. */
  readonly persistentPowerShell?: false | {
    readonly backendType?: string;
    readonly timeoutMs?: number;
    readonly maxOutputChars?: number;
    readonly description?: string;
  };
  readonly sandboxPolicy?: false | {
    readonly mode?: "read-only" | "workspace-write" | "danger-full-access";
    readonly workspaceRoot?: string;
  };
  /** Official platform sandbox selector: Windows ACL, Linux Landlock/bwrap, or macOS Seatbelt. */
  readonly localSandbox?: false | DshLocalSandboxConfig;
  readonly permissionPresets?: false | {
    readonly defaultPreset?: string;
    readonly presets?: Readonly<Record<string, { readonly sandbox: "read-only" | "workspace-write" | "danger-full-access"; readonly approval: "ask" | "never"; readonly name?: string; readonly description?: string }>>;
  };
  /** Official ripgrep-backed glob and grep discovery tools. */
  readonly fileSearchTools?: false | {
    readonly sampleOverCapGlobResults?: boolean;
    readonly globMaxResults?: number;
    readonly grepMaxMatches?: number;
    readonly grepMaxLineBytes?: number;
    readonly searchMetaMaxBytes?: number;
    readonly rawOutputMaxBytes?: number;
    readonly graceMs?: number;
    readonly stderrMaxBytes?: number;
    readonly timeoutMs?: number;
  };
  /** Official layered skill registry, filesystem provider, catalog, and loader tool. */
  readonly skills?: false | {
    readonly collectCacheMaxEntries?: number;
    /** Optional promotional skill; disabled by default to match the DSH base profile. */
    readonly badge?: boolean;
    readonly filesystem?: false | {
      readonly providerName?: string;
      readonly includeDefaultRoots?: boolean;
      readonly dshHome?: string;
      readonly agentsHome?: string;
      readonly customSkillDirs?: readonly string[];
      readonly watch?: boolean;
      readonly watchUsePolling?: boolean;
      readonly watchStabilityThresholdMs?: number;
      readonly watchPollIntervalMs?: number;
      readonly watchMaxProjects?: number;
      readonly watchFollowSymlinks?: boolean;
      readonly bundledSkillDir?: string;
    };
    readonly tool?: false | { readonly catalogDescriptionMaxLength?: number };
  };
  /** Cooperative enforcement of each DSH tool definition's timeoutMs. */
  readonly toolCallTimeoutPolicy?: false;
  /** Opt-in official dynamic Host-half runner and model-facing Cordis toolset. */
  readonly dynamicCordis?: false | { readonly vmTimeoutMs?: number };
  /** Private local storage and bounded inline projection for oversized DSH tool text. */
  readonly spill?: false | {
    readonly root?: string;
    readonly cleanupPeriodDays?: number;
    readonly maxInlineBytes?: number;
  };
  /** Worker-thread JavaScript orchestration over the bridged subagent runtime. */
  readonly workflow?: false | {
    readonly provider?: string;
    readonly maxConcurrentAgents?: number;
    readonly maxTotalAgents?: number;
    readonly maxItemsPerCall?: number;
    readonly syncTimeoutMs?: number;
    readonly disposeGraceMs?: number;
    readonly toolName?: string;
    readonly maxResultChars?: number;
  };
  /** Official fresh-agent iterative Ralph loop over the Seal structured subagent provider. */
  readonly ralph?: false | {
    readonly maxRounds?: number;
    readonly maxHandoffChars?: number;
    readonly maxResultChars?: number;
  };
  /** Official continuable-by-default DSH delegation tool over the Seal subagent provider. */
  readonly subagentTool?: false | {
    readonly provider?: string;
    readonly toolName?: string;
    readonly enableRunInBackground?: boolean;
  };
  /** Official one-shot completed-turn fork delegation tool. */
  readonly subagentForkTool?: false | { readonly toolName?: string };
  /** Official send_message, interrupt_agent, and list_agents continuation controls. */
  readonly subagentControlTools?: false;
  /** Official replay-aware token-meter and basic compaction backend. */
  readonly compaction?: false | {
    readonly thresholdRatio?: number;
    readonly retainRatio?: number;
    readonly retainTokens?: number;
    readonly summarizationProvider?: string;
    readonly summarizationModel?: string;
    readonly maxTokens?: number;
    readonly compactionRetries?: number;
    readonly maxOverflowRetries?: number;
    readonly auto?: boolean;
  };
}

export interface DshCompatService {
  readonly context: CordisContext;
  readonly fibers: readonly CordisFiber[];
  /** Whether DSH Agent/Session mutations share the active Seal SessionStore authority. */
  readonly sealSessionAuthority?: boolean;
}

type DshPermissionMode = "read-only" | "workspace-write" | "danger-full-access";

const DSH_BASE_PERMISSION_PRESETS = {
  "read-only": { sandbox: "read-only", approval: "ask" },
  "workspace-write": { sandbox: "workspace-write", approval: "ask" },
  "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
} as const;

function dshPermissionMode(value: string | undefined): DshPermissionMode {
  const mode = value ?? "workspace-write";
  if (mode !== "read-only" && mode !== "workspace-write" && mode !== "danger-full-access") {
    throw new TypeError('DSH_PERMISSION_MODE must be one of "read-only", "workspace-write", or "danger-full-access"');
  }
  return mode;
}

export const dshCompatServiceToken = createServiceToken<DshCompatService>(
  "seal-harness.dsh-compat",
);

export class DshCompatRuntime implements DshCompatService {
  #sealSessionAuthority = false;
  get sealSessionAuthority(): boolean { return this.#sealSessionAuthority; }
  // DSH Agent contexts shadow this sentinel with their live Agent. Standing
  // Agent-Preset scopes intentionally inherit `undefined`; without the own
  // context property Cordis interprets `ctx.agent` as an undeclared service
  // access before the preset has an Agent to bind.
  readonly context = new CordisContext().extend({ agent: undefined });
  readonly fibers: CordisFiber[] = [];
  readonly #externalDisposers = new Set<() => unknown>();
  #stopped = false;

  constructor(
    readonly tools: ToolService | undefined,
    readonly config: DshCompatConfig,
    readonly contexts: ContextService | undefined = undefined,
    readonly agents: AgentService | undefined = undefined,
    readonly sessions: SessionStore | undefined = undefined,
    readonly models: ModelService | undefined = undefined,
    readonly subagents: SubagentService | undefined = undefined,
    readonly attachments: AttachmentService | undefined = undefined,
    readonly sandbox: SandboxService | undefined = undefined,
    readonly credentials: CredentialService | undefined = undefined,
    readonly approval: ApprovalService | undefined = undefined,
    readonly userQuestions: UserQuestionService | undefined = undefined,
    readonly jobs: JobService | undefined = undefined,
    readonly settings: SettingsService | undefined = undefined,
    readonly messageFeedback: MessageFeedbackService | undefined = undefined,
    readonly lsp: LspService | undefined = undefined,
    readonly agentPresets: AgentPresetService | undefined = undefined,
  ) {}

  async start(): Promise<void> {
    const legacyExternal = this.config.externalSubagents;
    if (legacyExternal && [legacyExternal.claudeCode, legacyExternal.codex].some(value => value !== undefined && value !== false)) {
      throw new Error("Seal uses PI as its only agent engine; externalSubagents.claudeCode/codex are no longer supported. Use Seal PI-backed subagents.");
    }
    if (this.config.plugins !== undefined && !Array.isArray(this.config.plugins)) throw new TypeError("DSH compatibility plugins must be an array");
    if (this.config.configFile !== undefined && (typeof this.config.configFile !== "string" || this.config.configFile.trim().length === 0)) throw new TypeError("DSH compatibility configFile must be a non-empty path or file URL");
    if (this.config.hmr !== undefined && this.config.configFile === undefined) throw new TypeError("DSH compatibility hmr requires configFile");
    // Agent Presets captures this base during construction and uses it for
    // bare package rows.  That base must be the installed harness even when a
    // deployment config is also present; the config include gets its own base
    // immediately before the Loader creates it below.
    if (this.config.agentPresets !== undefined && this.config.agentPresets !== false) this.context.baseUrl = import.meta.url;
    else if (this.config.configFile !== undefined) this.context.baseUrl = asFileUrl(this.config.configFile);
    const startupTimeoutMs = positiveDuration(this.config.startupTimeoutMs ?? 10_000);
    assertToolRisk(this.config.defaultToolRisk ?? "external", "defaultToolRisk");
    for (const [name, risk] of Object.entries(this.config.toolRisks ?? {})) {
      assertToolRisk(risk, `toolRisks.${name}`);
    }
    const services = this.config.services ?? {};
    for (const [name, service] of Object.entries(services)) {
      if (name.trim().length === 0) throw new TypeError("DSH service name must not be empty");
      if (name === "tools" && this.tools !== undefined) {
        throw new Error("DSH service 'tools' is reserved by the Seal Harness tool bridge");
      }
      const ownsExportRoute = this.config.sessionLogExport !== undefined && this.config.sessionLogExport !== false;
      this.context.provide(name, name === "connection" && ownsExportRoute ? trackConnectionRegistrations(service, this.#externalDisposers) : service);
    }
    const workspaceRegistry = this.context.get("workspaceRegistry") as { subscribeDomainChanges?: (listener: (change: unknown) => void) => () => unknown } | undefined;
    if (workspaceRegistry?.subscribeDomainChanges !== undefined) {
      this.#externalDisposers.add(workspaceRegistry.subscribeDomainChanges((change) => { void this.context.emit("domain/changed", change as never); }));
    }
    if (this.config.launchEnvironment !== false && this.context.get(DSH_LAUNCH_ENVIRONMENT_KEY) === undefined) {
      const processValues = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const configured = this.config.launchEnvironment ?? {};
      this.context.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
        { source: "process", values: processValues },
        ...(configured.project === undefined ? [] : [{ source: "project-env" as const, path: resolve(configured.project.path), values: { ...configured.project.values } }]),
        ...(configured.user === undefined ? [] : [{ source: "user-env" as const, path: resolve(configured.user.path), values: { ...configured.user.values } }]),
      ]));
    }
    if (
      this.config.directoryPicker !== false
      && this.context.get("webServer") !== undefined
      && this.context.get("directoryPicker") === undefined
    ) {
      const configuredBackend = this.config.directoryPicker?.backend ?? "auto";
      const webServer = this.context.get("webServer") as { readonly host?: unknown } | undefined;
      const pickerBackend = configuredBackend === "auto"
        ? resolveDirectoryPickerBackend({
          bindHost: webServer?.host === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0",
          platform: process.platform,
          env: process.env,
          linuxChooser: hasLinuxChooserBinary(process.env.PATH, canExecute),
        })
        : configuredBackend;
      const directoryPickerFiber = pickerBackend === "native"
        ? this.context.plugin(DshNativeDirectoryPicker)
        : this.context.plugin(DshBrowseDirectoryPicker, { maxEntries: this.config.directoryPicker?.maxEntries ?? 1_000 });
      this.fibers.push(directoryPickerFiber);
      await directoryPickerFiber;
    }
    if (this.config.typert !== false && this.context.get("typert") === undefined) new DshTypertRegistry(this.context);
    if (this.config.typertGateway !== false && this.context.get("typert") !== undefined && this.context.get("typertGateway") === undefined) {
      new DshTypertGateway(this.context, {
        websocketHeartbeatIntervalMs: this.config.typertGateway?.websocketHeartbeatIntervalMs ?? 2_000,
      });
    }
    if (this.config.settingsFile !== false && this.context.get("settings") === undefined) {
      const path = this.config.settingsFile?.path ?? this.settings?.documentPath;
      const settingsFiber = this.context.plugin(DshFileSettings, {
        ...(path === undefined ? {} : { path }),
        ...(this.config.settingsFile?.dshHome === undefined ? {} : { dshHome: this.config.settingsFile.dshHome }),
        watch: this.config.settingsFile?.watch ?? true,
        debounceMs: this.config.settingsFile?.debounceMs ?? 100,
      });
      this.fibers.push(settingsFiber);
      await settingsFiber;
    }
    // The browser Models surface stores the product welcome acknowledgement
    // in the namespace registered by the host half of Settings General.
    const settingsGeneralHostFiber = this.context.plugin(DshUiSettingsGeneralHost);
    this.fibers.push(settingsGeneralHostFiber);
    await settingsGeneralHostFiber;
    // The official controller deliberately exists even before/without a provider:
    // Loader entries may publish settings later, and absent-provider calls must
    // retain the upstream actionable RemoteError instead of losing the namespace.
    if (this.context.get("settingsController") === undefined) new DshSettingsController(this.context);
    if (this.context.get("subagentModelSelection") === undefined) new DshSubagentModelSelectionConfig(this.context);
    if (this.config.invariants !== false && this.context.get("invariants") === undefined) new DshInvariantRegistry(this.context, this.config.invariants === undefined ? {} : { ...this.config.invariants, package_allowlist: [...(this.config.invariants.package_allowlist ?? [])], package_blocklist: [...(this.config.invariants.package_blocklist ?? [])] });
    if (this.config.approval !== false && this.context.get("approval") === undefined) {
      const policy = this.config.approval?.policy ?? (process.env.DSH_PERMISSION_MODE === "danger-full-access" ? "never" : "ask");
      new DshApprovalService(this.context, { policy });
      if (this.approval !== undefined) this.context.on("approval/request" as any, async (request: any) => {
        const signal = request.signal ?? new AbortController().signal;
        if (signal.aborted) return "cancelled";
        try {
          const allowed = await this.approval!.request({ sessionId: sessionId(String(request.agent.id)), title: `Approve ${String(request.toolName)}`, message: request.reason ?? `Allow ${String(request.toolName)} for session ${String(request.agent.id)}?`, details: { toolName: String(request.toolName), ...(request.callId === undefined ? {} : { callId: String(request.callId) }) }, signal });
          return signal.aborted ? "cancelled" : allowed ? "allowed-once" : "rejected";
        } catch { return signal.aborted ? "cancelled" : "unavailable"; }
      });
    }
    if (this.context.get("userQuestions") === undefined) {
      new DshUserQuestionService(this.context);
      if (this.userQuestions !== undefined) this.context.on("user-questions/request" as any, async (request: any, next: () => Promise<any>) => {
        if (request.agent === undefined) return next();
        return this.userQuestions!.ask({ sessionId: String(request.agent.id) as never, questions: request.questions, ...(request.signal === undefined ? {} : { signal: request.signal }) });
      });
    }
    if (this.messageFeedback !== undefined && this.context.get("messageFeedback") === undefined) new SealMessageFeedbackBridge(this.context, this.messageFeedback);

    if (this.tools !== undefined) {
      new SealToolRuntimeBridge(this.context, this.tools, {
        defaultRisk: this.config.defaultToolRisk ?? "external",
        risks: this.config.toolRisks ?? {},
        presentation: this.config.toolPresentation ?? "native",
        maxParallelCodeCalls: positiveInteger(this.config.maxParallelCodeCalls ?? 10, "maxParallelCodeCalls"),
      }, this.contexts);
    }
    if (this.config.mcp !== false) {
      for (const endpoint of this.config.mcp ?? []) {
        const config = endpoint.transport === "stdio"
          ? { ...endpoint, args: [...(endpoint.args ?? [])], env: { ...(endpoint.env ?? {}) }, cwd: endpoint.cwd ?? "", toolCallTimeoutMs: endpoint.toolCallTimeoutMs ?? 60_000, failOnStartupError: endpoint.failOnStartupError ?? false, ...(endpoint.reconnect === undefined ? {} : { reconnect: { ...endpoint.reconnect } }) }
          : { ...endpoint, headers: { ...(endpoint.headers ?? {}) }, toolCallTimeoutMs: endpoint.toolCallTimeoutMs ?? 60_000, failOnStartupError: endpoint.failOnStartupError ?? false, ...(endpoint.reconnect === undefined ? {} : { reconnect: { ...endpoint.reconnect } }) };
        const mcpFiber = this.context.plugin(DshMcpClient, config as any);
        this.fibers.push(mcpFiber);
        await mcpFiber;
      }
    }
    if (this.config.toolCallTimeoutPolicy !== false) {
      const timeoutFiber = this.context.plugin(DshToolCallTimeoutPolicy);
      this.fibers.push(timeoutFiber);
      await timeoutFiber;
    }
    const standaloneModelHost = this.models === undefined && this.agents === undefined
      && this.sessions === undefined && this.credentials === undefined;
    const officialDeepSeekEnabled = this.config.deepseekLlm !== false
      && (this.config.deepseekLlm !== undefined || standaloneModelHost);
    const officialPiAiEnabled = this.config.piAiLlm !== false
      && (this.config.piAiLlm !== undefined || standaloneModelHost);
    if (this.config.schedule !== false && !["schedule_create", "schedule_list", "schedule_delete"].some((name) => this.hasSealTool(name))) {
      this.fibers.push(this.context.plugin(DshSchedule));
    }
    const activeAgents = this.context.get("agents") as unknown;
    const sealAgentRegistry = activeAgents === undefined
      ? new SealAgentRegistryBridge(this.context, this.agents, this.sessions,
          this.config.agentPresets !== undefined && this.config.agentPresets !== false ? import.meta.url : this.context.baseUrl)
      : activeAgents instanceof SealAgentRegistryBridge
        ? activeAgents
        : undefined;
    this.#sealSessionAuthority = sealAgentRegistry !== undefined;
    if (this.config.fileReferences !== false && this.context.get("fileReferences") === undefined && this.context.get("agents") !== undefined) {
      new DshLocalFileReferenceService(this.context, {
        ...(this.config.fileReferences?.maxResults === undefined ? {} : { maxResults: this.config.fileReferences.maxResults }),
        ...(this.config.fileReferences?.maxEntries === undefined ? {} : { maxEntries: this.config.fileReferences.maxEntries }),
        ...(this.config.fileReferences?.excludedDirectories === undefined ? {} : { excludedDirectories: [...this.config.fileReferences.excludedDirectories] }),
      });
    }
    if (this.config.repeatToolReminder !== false) {
      const reminder = this.config.repeatToolReminder ?? {};
      const reminderFiber = this.context.plugin(DshRepeatToolReminder, {
        ...(reminder.thresholds === undefined ? {} : { thresholds: [...reminder.thresholds] }),
        ...(reminder.include === undefined ? {} : { include: [...reminder.include] }),
        ...(reminder.exclude === undefined ? {} : { exclude: [...reminder.exclude] }),
        ...(reminder.argumentsPreviewChars === undefined ? {} : { argumentsPreviewChars: reminder.argumentsPreviewChars }),
      });
      this.fibers.push(reminderFiber);
      await reminderFiber;
    }
    const sessionRegistry = this.context.get("sessions") ?? new CompatibleSessionStore(this.context, sealAgentRegistry);
    if (this.config.sessionPersistenceJsonl !== false && this.context.get("sessionPersistence") === undefined
      && (this.config.sessionPersistenceJsonl !== undefined || this.sessions === undefined)) {
      const persistence = this.config.sessionPersistenceJsonl ?? {};
      const persistenceFiber = this.context.plugin(DshJsonlSessionPersistence, {
        ...persistence,
        root: persistence.root ?? dshHomePath("sessions"),
      });
      this.fibers.push(persistenceFiber);
      await persistenceFiber;
    }
    if (this.sessions !== undefined && this.context.get("sessionPersistence") === undefined) new SealSessionPersistenceBridge(this.context, this.sessions, sessionRegistry as CompatibleSessionStore);
    if (this.context.get("sessionProjections") === undefined) new DshSessionProjections(this.context);
    if (this.config.agentPresets !== undefined && this.config.agentPresets !== false && this.context.get("agentPresets") === undefined) {
      if (this.context.get("loader") === undefined) await this.context.plugin(Loader);
      this.context.loader.builtins.include = Include;
      this.context.loader.builtins.group = Group;
      const presetsFiber = this.context.plugin(DshAgentPresets, {
        default: this.config.agentPresets.default,
        roots: (this.config.agentPresets.roots ?? []).map((root) => ({ path: resolve(root.path), trust: root.trust ?? "user" })),
        includeShippedRoot: this.config.agentPresets.includeShippedRoot ?? true,
        includeUserRoot: this.config.agentPresets.includeUserRoot ?? true,
      });
      this.fibers.push(presetsFiber);
      await presetsFiber;
    }
    const telemetryDisabledByEnvironment = (process.env.DSH_TELEMETRY_DISABLED?.length ?? 0) > 0;
    if (this.config.sessionTelemetry !== false && !telemetryDisabledByEnvironment && this.context.get("sessionTelemetry") === undefined) {
      const telemetry = this.config.sessionTelemetry ?? {};
      const telemetryMode = telemetry.mode ?? process.env.DSH_TELEMETRY_MODE ?? "DISABLED";
      const uploading = telemetryMode !== "DISABLED";
      const exporter = uploading ? {
        url: process.env.DSH_TELEMETRY_OTLP_URL ?? "https://harness-telemetry.deepseeksvc.com/v1/logs",
        compression: "gzip",
        timeoutMillis: 1_000,
        ...(telemetry.exporter ?? {}),
      } : telemetry.exporter;
      const processor = uploading ? {
        scheduledDelayMillis: 10_000,
        maxQueueSize: 2_048,
        maxExportBatchSize: 2_048,
        exportTimeoutMillis: 1_500,
        ...(telemetry.processor ?? {}),
      } : telemetry.processor;
      new DshOpenTelemetrySessionBackend(this.context, {
        mode: telemetryMode as DshSessionTelemetryMode,
        ...(exporter === undefined ? {} : { exporter }),
        ...(processor === undefined ? {} : { processor }),
        shutdownTimeoutMillis: telemetry.shutdownTimeoutMillis ?? 3_000,
      });
    }
    if (this.config.terminal !== false && this.context.get("terminals") === undefined) new DshTerminalSessionService(this.context);
    if (this.config.lsp !== false && this.context.get("lsp") === undefined) {
      if (this.lsp === undefined) new DshLsp(this.context);
      else new SealLspBridge(this.context, this.lsp);
    }
    if (this.config.web !== false && this.context.get("web") === undefined) {
      new DshWebRuntime(this.context, {
        searchProvider: this.config.web?.searchProvider ?? "deepseek-official",
        fetchProvider: this.config.web?.fetchProvider ?? "http",
      });
      if (this.config.web?.fetchHttp !== false) {
        const fetchFiber = this.context.plugin(DshWebFetchHttp, this.config.web?.fetchHttp ?? {});
        this.fibers.push(fetchFiber);
        await fetchFiber;
      }
      const searchProviders = this.config.web?.searchProviders;
      for (const [provider, module] of [
        [searchProviders?.deepseek ?? { apiKeyEnv: "DEEPSEEK_API_KEY" }, DshWebSearchDeepSeek],
        [searchProviders?.exa, DshWebSearchExa],
        [searchProviders?.perplexity, DshWebSearchPerplexity],
      ] as const) {
        if (provider === undefined || provider === false) continue;
        const providerFiber = this.context.plugin(module, provider);
        this.fibers.push(providerFiber);
        await providerFiber;
      }
    }
    if (this.config.timeContext !== false) {
      const timeContextFiber = this.context.plugin(DshTimeContext, this.config.timeContext ?? {});
      this.fibers.push(timeContextFiber);
      await timeContextFiber;
    }
    const e2b = this.config.e2b === undefined || this.config.e2b === false ? undefined : this.config.e2b;
    if (e2b !== undefined) {
      const remoteCwd = e2b.cwd ?? "/home/user/workspace";
      const configuredSandboxPolicy = this.config.sandboxPolicy === false ? undefined : this.config.sandboxPolicy;
      if (configuredSandboxPolicy?.mode !== undefined && configuredSandboxPolicy.mode !== "danger-full-access") throw new Error("dsh-compat: E2B requires sandboxPolicy.mode danger-full-access because the E2B boundary, not a nested local backend, provides confinement");
      if (configuredSandboxPolicy?.workspaceRoot !== undefined && configuredSandboxPolicy.workspaceRoot !== remoteCwd) throw new Error("dsh-compat: E2B cwd and sandboxPolicy.workspaceRoot must match");
      if (this.config.permissionPresets !== undefined && this.config.permissionPresets !== false && Object.values(this.config.permissionPresets.presets ?? {}).some((preset) => preset.sandbox !== "danger-full-access")) throw new Error("dsh-compat: E2B permission presets may only use danger-full-access inside the remote sandbox boundary");
      const { fileSystem: enableFileSystem = true, subprocess = {}, ...runtimeConfig } = e2b;
      const runtimeFiber = this.context.plugin(DshE2BRuntime, runtimeConfig); this.fibers.push(runtimeFiber); await runtimeFiber;
      if (enableFileSystem && this.context.get("fs") === undefined) {
        const fileSystemFiber = this.context.plugin(DshE2BFileSystem); this.fibers.push(fileSystemFiber); await fileSystemFiber;
      }
      if (subprocess !== false && this.context.get("subprocess") === undefined) {
        const subprocessFiber = this.context.plugin(DshE2BSubprocess, subprocess); this.fibers.push(subprocessFiber); await subprocessFiber;
      }
    }
    if (this.sandbox !== undefined && this.context.get("sandbox") === undefined) new SealSandboxProvider(this.context, this.sandbox);
    if (e2b === undefined && this.sandbox === undefined && this.config.localSandbox !== false && this.context.get("sandbox") === undefined) {
      const localSandbox = this.config.localSandbox ?? {};
      new DshLocalSandboxProvider(this.context, {
        runnerCommand: [...(localSandbox.runnerCommand ?? [])],
        runnerFailureSignatures: [...(localSandbox.runnerFailureSignatures ?? [])],
        probeTimeoutMs: localSandbox.probeTimeoutMs ?? 5_000,
      });
    }
    if (this.config.sandboxPolicy !== false && (this.context.get("sandbox") !== undefined || e2b !== undefined) && this.context.get("sandboxPolicy") === undefined) {
      new DshSandboxPolicy(this.context, {
        mode: this.config.sandboxPolicy?.mode ?? (e2b === undefined ? dshPermissionMode(process.env.DSH_PERMISSION_MODE) : "danger-full-access"),
        workspaceRoot: this.config.sandboxPolicy?.workspaceRoot ?? (e2b === undefined ? process.cwd() : e2b.cwd ?? "/home/user/workspace"),
      });
    }
    if (this.config.fileSystem !== false && this.context.get("fs") === undefined) {
      const fileSystemConfig = {
        cwd: this.config.fileSystem?.cwd ?? process.cwd(),
        diffBasisMaxBytes: this.config.fileSystem?.diffBasisMaxBytes ?? 10 * 1024 * 1024,
      };
      if (this.context.get("sandboxPolicy") === undefined) new DshLocalFileSystem(this.context, fileSystemConfig);
      else new DshSandboxedFileSystem(this.context, fileSystemConfig);
    }
    if (this.config.fileSystemObservationPolicy !== false && this.context.get("fs") !== undefined) {
      const observationFiber = this.context.plugin(DshFileSystemObservationPolicy);
      this.fibers.push(observationFiber);
      await observationFiber;
    }
    if (this.config.fileSystemTools !== false && this.context.get("fs") !== undefined) {
      const fileToolsFiber = this.context.plugin(DshToolFileSystem, this.config.fileSystemTools ?? {});
      this.fibers.push(fileToolsFiber);
      await fileToolsFiber;
    }
    if (this.config.strReplaceEditor !== false && this.context.get("fs") !== undefined && !this.hasSealTool("str_replace_editor")) {
      const editorFiber = this.context.plugin(DshToolStrReplaceEditor, {
        maxOutputChars: this.config.strReplaceEditor?.maxOutputChars ?? 16_000,
        ...(this.config.strReplaceEditor?.description === undefined ? {} : { description: this.config.strReplaceEditor.description }),
      });
      this.fibers.push(editorFiber);
      await editorFiber;
    }
    if (this.context.get("jobs") === undefined) {
      if (this.jobs !== undefined) new SealJobRegistry(this.context, this.jobs);
      else if (this.config.localJobs !== false) new DshLocalJobRegistry(this.context, {
        maxConcurrentJobsPerOwner: this.config.localJobs?.maxConcurrentJobsPerOwner ?? 10,
      });
    }
    const hostShellEnabled = e2b !== undefined ? this.config.bash !== false : process.platform === "win32" ? this.config.powerShell !== false : this.config.bash !== false;
    if ((hostShellEnabled || this.config.fileSearchTools !== false) && this.context.get("subprocess") === undefined) new DshLocalSubprocess(this.context);
    if (this.config.fileSearchTools !== false && this.context.get("subprocess") !== undefined) {
      const searchFiber = this.context.plugin(DshToolFileSearch, {
        sampleOverCapGlobResults: this.config.fileSearchTools?.sampleOverCapGlobResults ?? false,
        ...this.config.fileSearchTools,
      });
      this.fibers.push(searchFiber);
      await searchFiber;
    }
    if (hostShellEnabled && this.context.get("subprocess") !== undefined) {
      if (this.context.get("shellEnv") === undefined) {
        const envFiber = this.context.plugin(DshShellEnv, {});
        this.fibers.push(envFiber);
        await envFiber;
      }
      if (this.context.get("shell") === undefined) {
        const sandboxed = e2b === undefined && this.context.get("sandbox") !== undefined && this.context.get("sandboxPolicy") !== undefined;
        const { enableRunInBackground: _bashBackground, ...bashExecutorConfig } = this.config.bash === false ? {} : this.config.bash ?? {};
        const shellPlugin = e2b !== undefined ? DshBashLocal : process.platform === "win32"
          ? sandboxed ? DshPwshSandbox : DshPwshLocal
          : sandboxed ? DshBashSandbox : DshBashLocal;
        const shellConfig = e2b === undefined && process.platform === "win32" ? this.config.powerShell ?? {} : bashExecutorConfig;
        const shellFiber = this.context.plugin(shellPlugin as CordisPlugin, shellConfig);
        this.fibers.push(shellFiber);
        await shellFiber;
      }
      if (e2b === undefined && process.platform === "win32" && (this.config.persistentPowerShell === undefined || this.config.persistentPowerShell === false)) {
        const toolFiber = this.context.plugin(DshToolPwsh, { enableRunInBackground: this.context.get("jobs") !== undefined });
        this.fibers.push(toolFiber);
        await toolFiber;
      } else if ((e2b !== undefined || process.platform !== "win32") && !this.hasSealTool("bash")) {
        const toolFiber = this.context.plugin(DshToolBash, {
          enableRunInBackground: (this.config.bash === false ? undefined : this.config.bash?.enableRunInBackground) ?? this.context.get("jobs") !== undefined,
        });
        this.fibers.push(toolFiber);
        await toolFiber;
      }
    }
    if (this.config.hooks !== false) {
      const hookEntries = [
        [this.config.hooks?.claudeCode, DshHooksClaudeCode, "Claude Code"],
        [this.config.hooks?.codex, DshHooksCodex, "Codex"],
      ] as const;
      for (const [hookConfig, hookPlugin, label] of hookEntries) {
        if (hookConfig === undefined || hookConfig === false) continue;
        if (this.context.get("shell") === undefined || this.context.get("sessionProjections") === undefined) {
          throw new Error(`dsh-compat: ${label} hooks require the official shell and sessionProjections services`);
        }
        const hookFiber = this.context.plugin(hookPlugin, hookConfig as any);
        this.fibers.push(hookFiber);
        await hookFiber;
      }
    }
    if (this.config.permissionPresets !== false && (e2b === undefined || this.config.permissionPresets !== undefined) && this.context.get("sandboxPolicy") !== undefined && this.context.get("shell") !== undefined && this.context.get("approval") !== undefined && this.context.get("sessions") !== undefined && this.context.get("permissionPresets") === undefined) {
      const presets = this.config.permissionPresets?.presets ?? DSH_BASE_PERMISSION_PRESETS;
      const presetFiber = this.context.plugin(DshPermissionPresets, {
        presets: { ...presets },
        ...(this.config.permissionPresets?.defaultPreset === undefined ? {} : { defaultPreset: this.config.permissionPresets.defaultPreset }),
      });
      this.fibers.push(presetFiber);
      await presetFiber;
    }
    if (this.config.terminal !== false && this.context.get("terminals") !== undefined && this.context.get("sandboxPolicy") !== undefined && this.context.get("sessionProjections") !== undefined && this.context.get("subprocess") !== undefined) {
      const { tools: _terminalTools, shellArgs, ...terminalBackend } = this.config.terminal ?? {};
      const terminalFiber = this.context.plugin(DshTerminalBash, {
        shellDialect: e2b === undefined && process.platform === "win32" ? "pwsh" : "bash",
        ...terminalBackend,
        ...(shellArgs === undefined ? {} : { shellArgs: [...shellArgs] }),
      });
      this.fibers.push(terminalFiber);
      await terminalFiber;
    }
    if (this.config.persistentPowerShell !== undefined && this.config.persistentPowerShell !== false) {
      if (this.context.get("terminals") === undefined || this.context.get("tools") === undefined) {
        throw new Error("dsh-compat: persistent PowerShell requires terminal and tools services");
      }
      const persistentPwshFiber = this.context.plugin(DshToolPwshPersistent, this.config.persistentPowerShell);
      this.fibers.push(persistentPwshFiber);
      await persistentPwshFiber;
    }
    if (this.config.agentInstructions !== false) {
      const instructions = this.config.agentInstructions ?? {};
      const instructionsFiber = this.context.plugin(DshAgentInstructions, {
        maxBytes: instructions.maxBytes ?? 65_536,
        ...(instructions.dshHome === undefined ? {} : { dshHome: instructions.dshHome }),
        ...(instructions.projectRootMarkers === undefined ? {} : { projectRootMarkers: [...instructions.projectRootMarkers] }),
        ...(instructions.maxSourceBytes === undefined ? {} : { maxSourceBytes: instructions.maxSourceBytes }),
        ...(instructions.instructionFileCandidates === undefined ? {} : { instructionFileCandidates: [...instructions.instructionFileCandidates] }),
        ...(instructions.localInstructionFileCandidates === undefined ? {} : { localInstructionFileCandidates: [...instructions.localInstructionFileCandidates] }),
      });
      this.fibers.push(instructionsFiber);
      await instructionsFiber;
    }
    if (this.config.skills !== false) {
      const skills = this.config.skills ?? {};
      if (this.context.get("skills") === undefined) new DshSkillRegistry(this.context, {
        collectCacheMaxEntries: skills.collectCacheMaxEntries ?? 128,
      });
      if (skills.filesystem !== false) {
        const filesystem = skills.filesystem ?? {};
        const { customSkillDirs, ...filesystemOptions } = filesystem;
        const filesystemFiber = this.context.plugin(DshSkillFilesystem, {
          ...filesystemOptions,
          ...(customSkillDirs === undefined ? {} : { customSkillDirs: [...customSkillDirs] }),
        });
        this.fibers.push(filesystemFiber);
        await filesystemFiber;
      }
      if (skills.badge === true) {
        const badgeFiber = this.context.plugin(DshSkillBadge);
        this.fibers.push(badgeFiber);
        await badgeFiber;
      }
      if (skills.tool !== false) {
        const toolFiber = this.context.plugin(DshToolSkill, skills.tool ?? {});
        this.fibers.push(toolFiber);
        await toolFiber;
      }
    }
    if (this.config.spill !== false) {
      const spill = this.config.spill ?? {};
      if (this.context.get("spillStore") === undefined) new DshLocalSpillStore(this.context, {
        ...(spill.root === undefined ? {} : { root: spill.root }),
        cleanupPeriodDays: spill.cleanupPeriodDays ?? 30,
      });
      const spillFiber = this.context.plugin(DshSpillPolicy, { maxInlineBytes: spill.maxInlineBytes ?? 50_000 });
      this.fibers.push(spillFiber);
      await spillFiber;
    }
    if (this.config.sessionStats !== false) {
      const statsFiber = this.context.plugin(DshSessionStats);
      this.fibers.push(statsFiber);
      await statsFiber;
    }
    if (this.config.sessionTurnOutline !== false) {
      const outlineFiber = this.context.plugin(DshSessionTurnOutline);
      this.fibers.push(outlineFiber);
      await outlineFiber;
    }
    if (this.config.sessionProjectionCache !== false) {
      const projectionCacheFiber = this.context.plugin(DshSessionProjectionCache, {
        writeEveryEvents: this.config.sessionProjectionCache?.writeEveryEvents ?? 200,
        writeIntervalMs: this.config.sessionProjectionCache?.writeIntervalMs ?? 5_000,
      });
      this.fibers.push(projectionCacheFiber);
    }
    if (this.config.sessionTitle !== false && this.context.get("sessionTitle") === undefined) new DshSessionTitle(this.context, {
      fallbackMaxWords: this.config.sessionTitle?.fallbackMaxWords ?? 5,
      fallbackMaxBytes: this.config.sessionTitle?.fallbackMaxBytes ?? 40,
      maxTitleBytes: this.config.sessionTitle?.maxTitleBytes ?? 80,
    });
    if (this.context.get("tokenMeter") === undefined) new DshTokenMeter(this.context, {});
    if (this.config.llmRetry !== false) {
      const retryFiber = this.context.plugin(DshLlmRetry, {});
      this.fibers.push(retryFiber);
      await retryFiber;
    }
    if (this.config.toolResultPruner !== false && this.context.get("toolResultPruner") === undefined) new DshToolResultPruner(this.context, this.config.toolResultPruner ?? {});
    if (this.context.get("sessionQuery") === undefined) {
      if (this.config.sessionQuerySqlite !== undefined && this.config.sessionQuerySqlite !== false) {
        new DshSqliteSessionQuery(this.context, this.config.sessionQuerySqlite);
      } else if (this.sessions === undefined && this.config.sessionQuerySqlite !== false) {
        new DshSqliteSessionQuery(this.context, { path: ":memory:", openAt: "never" });
      } else {
        new SealSessionQuery(this.context, this.context.get("agents") as SealAgentRegistryBridge | undefined, this.config.sessionQuerySearch ?? true);
      }
    }
    if (this.config.sessionReference !== false && this.context.get("sessionReferenceResolver") === undefined) {
      new DshSessionReference(this.context, this.config.sessionReference ?? {});
    }
    if (this.credentials !== undefined && this.context.get("credentials") === undefined) new SealCredentialProvider(this.context, this.credentials);
    if (this.credentials === undefined && this.config.localCredentials !== false && this.context.get("credentials") === undefined) {
      const credentialFiber = this.context.plugin(DshLocalCredentialProvider, this.config.localCredentials ?? {});
      this.fibers.push(credentialFiber);
      await credentialFiber;
    }
    if (this.config.authorization !== false
      && this.context.get("credentials") !== undefined
      && this.context.get("authorization") === undefined) {
      new DshAuthorization(this.context);
    }
    if (this.sandbox !== undefined && this.context.get("sandbox") === undefined) new SealSandboxProvider(this.context, this.sandbox);
    if (this.attachments !== undefined && this.context.get("attachments") === undefined) new SealAttachmentStore(this.context, this.attachments);
    if (this.attachments === undefined && this.config.localAttachments !== false && this.context.get("attachments") === undefined) {
      new DshLocalAttachmentStore(this.context, this.config.localAttachments ?? {});
    }
    const externalSubagents = this.config.externalSubagents === false ? undefined : this.config.externalSubagents;
    const inProcessSubagents = this.config.inProcessSubagents === false
      ? undefined
      : this.config.inProcessSubagents ?? (this.subagents === undefined ? { spawn: {}, fork: {} } : undefined);
    const inProcessSubagentsEnabled = inProcessSubagents?.spawn !== undefined && inProcessSubagents.spawn !== false
      || inProcessSubagents?.fork !== undefined && inProcessSubagents.fork !== false;
    const externalSubagentsEnabled = externalSubagents?.acp !== undefined && externalSubagents.acp !== false;
    if (this.subagents !== undefined && this.context.get("subagents") === undefined) new SealSubagentRuntime(this.context, this.subagents, this.agents);
    if (this.subagents === undefined && (externalSubagentsEnabled || inProcessSubagentsEnabled) && this.context.get("subagents") === undefined) new DshSubagentRuntime(this.context);
    if (inProcessSubagentsEnabled) {
      if (this.context.get("subagents") === undefined) throw new Error("dsh-compat: in-process subagents require the official subagents service");
      if (inProcessSubagents?.spawn !== undefined && inProcessSubagents.spawn !== false) {
        const fiber = this.context.plugin(DshSubagentSpawnInProcess, { providerName: inProcessSubagents.spawn.providerName ?? "spawn" });
        this.fibers.push(fiber); await fiber;
      }
      if (inProcessSubagents?.fork !== undefined && inProcessSubagents.fork !== false) {
        const fiber = this.context.plugin(DshSubagentForkInProcess, { providerName: inProcessSubagents.fork.providerName ?? "fork" });
        this.fibers.push(fiber); await fiber;
      }
    }
    if (externalSubagentsEnabled) {
      if (this.context.get("subagents") === undefined) throw new Error("dsh-compat: external subagents require the official subagents service");
      if (this.context.get("subprocess") === undefined) throw new Error("dsh-compat: ACP subagents require the subprocess service");
      {
        const config = externalSubagents.acp;
        const fiber = this.context.plugin(DshSubagentAcp, { ...config, providerName: config.providerName ?? "acp", args: [...(config.args ?? [])], permission: config.permission ?? "reject", env: { ...(config.env ?? {}) }, disposeEofGraceMs: config.disposeEofGraceMs ?? 6_000, disposeGraceMs: config.disposeGraceMs ?? 3_000 });
        this.fibers.push(fiber); await fiber;
      }
    }
    if (this.config.deepseekLlmApiExtensions !== false && this.context.get("deepseekLlmApiExtensions") === undefined) new DshDeepSeekLlmApiExtensions(this.context);
    if (this.config.deepseekSessionLog !== false
      && this.context.get("deepseekLlmApiExtensions") !== undefined
      && this.context.get("sessions") !== undefined) {
      const sessionLogFiber = this.context.plugin(DshSessionLogDeepSeek, this.config.deepseekSessionLog ?? {});
      this.fibers.push(sessionLogFiber);
      await sessionLogFiber;
    }
    if ((this.models !== undefined || officialDeepSeekEnabled || officialPiAiEnabled) && this.context.get("llm") === undefined) new DshLlmRuntime(this.context);
    if (this.models !== undefined) {
      const llm = this.context.get("llm") as DshLlmRuntime;
      const modelCatalog = await this.models.list();
      const providers = [...new Set(modelCatalog.map((model) => model.provider).filter((provider) => !officialDeepSeekEnabled || provider !== "deepseek-official"))];
      if (providers.length > 0) llm.registerAdapter(providers, new SealLlmAdapter(this.models, modelCatalog, this.context.get("attachments") as DshAttachmentStore | undefined));
      const configuredDefault = this.config.agentDefaultModel;
      const defaultModel = configuredDefault === false ? undefined : configuredDefault ?? modelCatalog[0];
      if (!officialDeepSeekEnabled && defaultModel !== undefined && this.context.get("agentDefaultModel") === undefined) new DshAgentDefaultModel(this.context, { provider: defaultModel.provider, model: defaultModel.model });
    }
    if (officialDeepSeekEnabled) {
      const deepSeekFiber = this.context.plugin(DshLlmDeepSeek, this.config.deepseekLlm ?? {});
      this.fibers.push(deepSeekFiber);
      await deepSeekFiber;
      if (this.config.agentDefaultModel !== false && this.context.get("agentDefaultModel") === undefined) {
        new DshAgentDefaultModel(this.context, this.config.agentDefaultModel ?? { provider: "deepseek-official", model: "deepseek-v4-flash" });
      }
    }
    if (officialPiAiEnabled) {
      const piAiFiber = this.context.plugin(DshLlmPiAi, this.config.piAiLlm ?? {});
      this.fibers.push(piAiFiber);
      await piAiFiber;
    }
    if (this.config.sessionTitle !== false && this.config.sessionTitle?.llm !== false && this.context.get("llm") !== undefined) {
      const titleProvider = this.config.sessionTitle?.llm?.strategy === "all-prompts" ? DshSessionTitleAllPromptsLlm : DshSessionTitleFirstPromptLlm;
      const titleFiber = this.context.plugin(titleProvider, {
        targetWords: this.config.sessionTitle?.llm?.targetWords ?? 5,
        targetCjkCharacters: this.config.sessionTitle?.llm?.targetCjkCharacters ?? 10,
        maxInputBytes: this.config.sessionTitle?.llm?.maxInputBytes ?? 4096,
        maxOutputTokens: this.config.sessionTitle?.llm?.maxOutputTokens ?? 64,
        timeoutMs: this.config.sessionTitle?.llm?.timeoutMs ?? 60_000,
        ...(this.config.sessionTitle?.llm?.provider === undefined ? {} : { provider: this.config.sessionTitle.llm.provider }),
        ...(this.config.sessionTitle?.llm?.model === undefined ? {} : { model: this.config.sessionTitle.llm.model }),
      });
      this.fibers.push(titleFiber);
      await titleFiber;
    }
    if (this.config.sessionCheckpointPolicy !== false) {
      const checkpointFiber = this.context.plugin(DshSessionCheckpointPolicy);
      this.fibers.push(checkpointFiber);
      if (["llm", "sessionPersistence", "sessions", "tools"].every((name) => this.context.get(name) !== undefined)) await checkpointFiber;
    }
    if (this.config.commands !== false && this.context.get("commands") === undefined) new DshCommandRuntime(this.context);
    if (this.config.compaction !== false && this.context.get("compaction") === undefined && this.context.get("llm") !== undefined) new DshBasicCompaction(this.context, this.config.compaction ?? {});
    const systemPromptConfig = this.config.systemPrompt ?? {};
    const { toolOrder: systemPromptToolOrder, ...systemPromptOptions } = systemPromptConfig;
    const systemPrompt = this.context.get("systemPrompt") ?? new DshSystemPrompt(this.context, {
      ...systemPromptOptions,
      includeHarnessIdentity: false,
      ...(systemPromptToolOrder === undefined ? {} : { toolOrder: [...systemPromptToolOrder] }),
    });
    // Execution belongs to Seal; compatible templates read its Agent context.
    {
      systemPrompt.variable("provider", (context) => context.agent?.options?.provider);
      systemPrompt.variable("model", (context) => context.agent?.options?.model);
      systemPrompt.variable("cwd", (context) => context.agent?.session.header.cwd as string | undefined);
    }
    if (this.config.dynamicCordis !== undefined && this.config.dynamicCordis !== false) {
      const runnerFiber = this.context.plugin(DshCordisHostRunner, { vmTimeoutMs: this.config.dynamicCordis.vmTimeoutMs ?? 5_000 });
      this.fibers.push(runnerFiber); await runnerFiber;
      const toolFiber = this.context.plugin(DshToolCordis);
      this.fibers.push(toolFiber); await toolFiber;
    }
    if (this.config.lsp !== false && this.config.lsp?.stdio !== undefined && this.config.lsp.stdio !== false) {
      if (!["fs", "lsp", "subprocess"].every((name) => this.context.get(name) !== undefined)) {
        throw new Error("dsh-compat: lsp.stdio requires the official fs, lsp, and subprocess services");
      }
      const servers = Object.fromEntries(Object.entries(this.config.lsp.stdio.servers).map(([id, server]) => {
        const { args, env, extensionToLanguage, ...options } = server;
        return [id, {
          ...options,
          extensionToLanguage: { ...extensionToLanguage },
          ...(args === undefined ? {} : { args: [...args] }),
          ...(env === undefined ? {} : { env: { ...env } }),
        }];
      }));
      const lspStdioFiber = this.context.plugin(DshLspStdio, { servers });
      this.fibers.push(lspStdioFiber);
      await lspStdioFiber;
    }
    if (this.config.terminal !== false && this.config.terminal?.tools !== false && this.context.get("terminals") !== undefined && this.context.get("tools") !== undefined && this.context.get("systemPrompt") !== undefined) {
      const terminalToolNames = ["terminal_open", "terminal_send", "terminal_read", "terminal_signal", "terminal_close", "terminal_list"];
      if (!terminalToolNames.some((name) => this.hasSealTool(name))) {
        const terminalToolFiber = this.context.plugin(DshToolTerminal, {
          enableRunInBackground: this.config.terminal?.tools?.enableRunInBackground ?? this.context.get("jobs") !== undefined,
          maxResultBytes: this.config.terminal?.tools?.maxResultBytes ?? 256 * 1024,
        });
        this.fibers.push(terminalToolFiber);
        await terminalToolFiber;
      }
    }
    if (this.config.lsp !== false && this.config.lsp?.tools !== false && this.context.get("lsp") !== undefined && this.context.get("tools") !== undefined && this.context.get("systemPrompt") !== undefined && !this.hasSealTool("lsp")) {
      const lspToolFiber = this.context.plugin(DshToolLsp, {
        maxLocations: this.config.lsp?.maxLocations ?? 100,
        maxResultChars: this.config.lsp?.maxResultChars ?? 16_000,
        timeoutMs: this.config.lsp?.timeoutMs ?? 60_000,
      });
      this.fibers.push(lspToolFiber);
      await lspToolFiber;
    }
    if (this.config.web !== false && this.config.web?.tools !== false && this.context.get("web") !== undefined && this.context.get("tools") !== undefined && this.context.get("systemPrompt") !== undefined && !["web_search", "web_fetch"].some((name) => this.hasSealTool(name))) {
      const webTools = this.config.web?.tools ?? {};
      const webToolFiber = this.context.plugin(DshToolWeb, {
        ...webTools,
        fetch: webTools.fetch ?? true,
        searchTimeoutMs: webTools.searchTimeoutMs ?? 60_000,
      });
      this.fibers.push(webToolFiber);
      await webToolFiber;
    }
    if (this.config.jobTools !== false && this.context.get("jobs") !== undefined && this.context.get("tools") !== undefined && this.context.get("systemPrompt") !== undefined && !["job_output", "job_list", "job_kill"].some((name) => this.hasSealTool(name))) {
      const jobToolFiber = this.context.plugin(DshToolJobs, this.config.jobTools ?? {});
      this.fibers.push(jobToolFiber);
      await jobToolFiber;
    }
    if (this.config.sessionQueryTools !== false && this.context.get("sessionQuery") !== undefined && this.context.get("sessionProjections") !== undefined && this.context.get("tools") !== undefined && this.context.get("systemPrompt") !== undefined) {
      const names = ["session_search", "session_event_search", "session_trace", "session_event_trace", "session_event_read"];
      if (!names.some((name) => this.hasSealTool(name))) {
        const queryToolFiber = this.context.plugin(DshToolSessionQuery, this.config.sessionQueryTools ?? {});
        this.fibers.push(queryToolFiber);
        await queryToolFiber;
      }
    }
    if (this.config.workflow !== false) {
      const workflow = this.config.workflow ?? {};
      const freshSubagentProvider = this.subagents === undefined ? "spawn" : "seal";
      const engineFiber = this.context.plugin(DshWorkflowWorkerThread, {
        provider: workflow.provider ?? freshSubagentProvider,
        maxConcurrentAgents: workflow.maxConcurrentAgents ?? 0,
        maxTotalAgents: workflow.maxTotalAgents ?? 1_000,
        maxItemsPerCall: workflow.maxItemsPerCall ?? 4_096,
        syncTimeoutMs: workflow.syncTimeoutMs ?? 5_000,
        disposeGraceMs: workflow.disposeGraceMs ?? 5_000,
      });
      this.fibers.push(engineFiber);
      if (this.context.get("subagents") !== undefined) await engineFiber;
      const workflowToolName = workflow.toolName ?? "workflow";
      if (!this.hasSealTool(workflowToolName)) {
        const toolFiber = this.context.plugin(DshToolWorkflow, {
          toolName: workflowToolName,
          maxResultChars: workflow.maxResultChars ?? 50_000,
        });
        this.fibers.push(toolFiber);
        if (this.context.get("workflowEngine") !== undefined) await toolFiber;
      }
    }
    if (this.config.ralph !== false && this.context.get("workflowEngine") !== undefined && this.context.get("subagents") !== undefined && this.context.get("systemPrompt") !== undefined && this.context.get("tools") !== undefined && !this.hasSealTool("ralph")) {
      const ralphFiber = this.context.plugin(DshToolRalph, {
        subagentProvider: this.subagents === undefined ? "spawn" : "seal",
        maxRounds: this.config.ralph?.maxRounds ?? 64,
        maxHandoffChars: this.config.ralph?.maxHandoffChars ?? 16_384,
        maxResultChars: this.config.ralph?.maxResultChars ?? 16_384,
      });
      this.fibers.push(ralphFiber);
      await ralphFiber;
    }
    if (this.config.subagentTool !== false && this.context.get("subagents") !== undefined) {
      const subagentTool = this.config.subagentTool ?? {};
      const toolFiber = this.context.plugin(DshToolSubagent, {
        provider: subagentTool.provider ?? (this.subagents === undefined ? "spawn" : "seal"),
        toolName: subagentTool.toolName ?? "subagent",
        enableRunInBackground: subagentTool.enableRunInBackground ?? true,
        backgroundMode: "continuable",
        maxDepth: "provider-managed",
      });
      this.fibers.push(toolFiber);
      await toolFiber;
    }
    if (this.config.subagentControlTools !== false && this.context.get("subagents") !== undefined && this.context.get("tools") !== undefined) {
      if (!["send_message", "interrupt_agent"].some((name) => this.hasSealTool(name))) {
        const controlFiber = this.context.plugin(DshToolSubagentControl);
        this.fibers.push(controlFiber);
        await controlFiber;
      }
      if (this.context.get("agents") !== undefined && !this.hasSealTool("list_agents")) {
        const listFiber = this.context.plugin(DshToolSubagentListAgents);
        this.fibers.push(listFiber);
        await listFiber;
      }
    }
    if (this.config.subagentForkTool !== false && this.context.get("subagents") !== undefined && !this.hasSealTool(this.config.subagentForkTool?.toolName ?? "subagent_fork")) {
      const forkFiber = this.context.plugin(DshToolSubagent, {
        provider: this.subagents === undefined ? "fork" : "seal-fork",
        toolName: this.config.subagentForkTool?.toolName ?? "subagent_fork",
        enableRunInBackground: true,
        backgroundMode: "one-shot",
        maxDepth: "provider-managed",
      });
      this.fibers.push(forkFiber);
      await forkFiber;
    }
    if (this.config.goals !== false && this.context.get("goals") === undefined) new DshGoalService(this.context, this.config.goals ?? {});
    if (this.config.goalRoundDriver !== false && this.context.get("goals") !== undefined && this.agents !== undefined) {
      const goalDriverFiber = this.context.plugin(DshGoalRoundDriver);
      this.fibers.push(goalDriverFiber);
      await goalDriverFiber;
    }
    if (this.config.goalTools !== false
      && ["agents", "goals", "tools", "systemPrompt", "sessionProjections"].every((name) => this.context.get(name) !== undefined)
      && !["get_goal", "create_goal", "update_goal"].some((name) => this.hasSealTool(name))) {
      const goalToolsFiber = this.context.plugin(DshToolGoal, {
        blockedAfterConsecutiveRounds: this.config.goalTools?.blockedAfterConsecutiveRounds ?? 3,
      });
      this.fibers.push(goalToolsFiber);
      await goalToolsFiber;
    }
    if (this.config.askUserTool !== false
      && this.context.get("tools") !== undefined
      && this.context.get("userQuestions") !== undefined
      && !this.hasSealTool("ask_user_question")) {
      const askUserFiber = this.context.plugin(DshToolAskUser);
      this.fibers.push(askUserFiber);
      await askUserFiber;
    }
    if (this.config.todoTool !== false && !this.hasSealTool("todo_write")) {
      const todoFiber = this.context.plugin(DshToolTodo, {
        allowParallelInProgress: this.config.todoTool?.allowParallelInProgress ?? true,
      });
      this.fibers.push(todoFiber);
      await todoFiber;
    }
    if (this.config.planMode !== false && this.context.get("tools") !== undefined && !this.hasSealTool("exit_plan_mode") && this.context.get("planMode") === undefined) {
      new DshPlanMode(this.context, { section: this.config.planMode?.section ?? DEFAULT_PLAN_MODE_SECTION });
    }
    if (this.config.commands !== false) {
      this.fibers.push(this.context.plugin(DshCommandFeedback));
      if (this.context.get("compaction") !== undefined) this.fibers.push(this.context.plugin(DshCommandCompact));
      if (this.context.get("goals") !== undefined) this.fibers.push(this.context.plugin(DshCommandGoal));
    }
    if (this.contexts !== undefined) {
      const dispose = this.contexts.register({ name: "dsh-system-prompt", contribute: async (request) => {
        const agent = sealAgentRegistry?.get(String(request.sessionId));
        const assembly = await systemPrompt.assemble({ ...(agent === undefined ? {} : { agent: agent as never, scope: dshScopeOf(agent.ctx) as never }), signal: request.signal });
        if (agent !== undefined) await sealAgentRegistry?.flushSession(String(request.sessionId));
        const system = renderPrompt(assembly);
        const additions = renderContextSections(assembly).map((section) => ({ id: messageId(crypto.randomUUID()), role: "user" as const, content: [text(section.text)], source: { kind: "plugin", plugin: `dsh-system-prompt:${section.name}` } }));
        return { ...(system.length === 0 ? {} : { systemPrompt: system }), ...(additions.length === 0 ? {} : { additions }) };
      } });
      this.context.effect(() => dispose);
    }
    if (this.config.codeRuntime !== false && this.context.get("codeRuntime") === undefined) {
      this.fibers.push(this.context.plugin(CodeRuntimeWorkerThread, this.config.codeRuntime ?? {}));
    }
    if (this.config.storage !== false && this.context.get("storage") === undefined) {
      const storage = this.config.storage ?? {};
      const storageBackend = storage.backend ?? "json";
      const backendFiber = storageBackend === "sqlite"
        ? this.context.plugin(StorageSqlite, {
            path: resolve(storage.path ?? ".seal-harness/dsh-storage.sqlite"),
            journalMode: storage.journalMode ?? "wal",
          })
        : this.context.plugin(StorageJson, { root: resolve(storage.root ?? dshHomePath("storages")) });
      const storageFibers = [
        this.context.plugin(Storage),
        backendFiber,
        this.context.plugin(StorageDomain, { backend: storageBackend, routes: storage.routes ?? {} }),
      ];
      this.fibers.push(...storageFibers);
      if (storageBackend === "sqlite") {
        await Promise.all(storageFibers);
        const backend = this.context.get(storageBackendServiceKey("sqlite")) as { close(): Promise<void> } | undefined;
        if (backend === undefined) throw new Error("SQLite Storage backend did not publish its service");
        // The official backend owns a native DatabaseSync handle. Retain an
        // idempotent close barrier in addition to Cordis disposal so Windows
        // has released the database before the Seal plugin is considered stopped.
        this.#externalDisposers.add(() => backend.close());
      }
      // A sidecar immediately opens a domain during its own init. Ordinary
      // compatibility instances retain Cordis' deferred activation so hot
      // reconfiguration can overlap generations without contending on Storage.
      if (this.config.messageFeedback !== undefined && this.config.messageFeedback !== false) await Promise.all(storageFibers);
    }
    if (this.config.messageFeedback !== undefined && this.config.messageFeedback !== false && this.config.storage !== false && this.context.get("messageFeedback") === undefined) {
      const feedbackFiber = this.context.plugin(DshMessageFeedback, { maxNoteBytes: this.config.messageFeedback.maxNoteBytes ?? 8_192 });
      this.fibers.push(feedbackFiber);
      await feedbackFiber;
    }
    if (this.config.sessionLogExport !== undefined && this.config.sessionLogExport !== false) {
      const required = ["commands", "connection", "sessionQuery", "sessionPersistence", "attachments"];
      const missing = required.filter((name) => this.context.get(name) === undefined);
      if (missing.length > 0) throw new Error(`sessionLogExport requires DSH services: ${missing.join(", ")}`);
      const exportFiber = this.context.plugin(DshSessionLogExport, this.config.sessionLogExport);
      this.fibers.push(exportFiber); await exportFiber;
    }

    try {
      for (const spec of this.config.plugins ?? []) {
        if (spec.enabled === false) continue;
        const source = normalizePlugin(spec.plugin);
        this.fibers.push(this.context.plugin(source as CordisPlugin, spec.config));
      }
      if (this.config.configFile !== undefined) {
        this.context.baseUrl = asFileUrl(this.config.configFile);
        if (this.context.get("loader") === undefined) await this.context.plugin(Loader);
        this.context.loader.builtins.include = Include;
        this.context.loader.builtins.group = Group;
        if (this.config.typertLoader !== false && this.context.get("typert") !== undefined) {
          const typertLoaderFiber = this.context.plugin(DshTypertLoader, {
            packages: [...(this.config.typertLoader?.packages ?? [])],
          });
          this.fibers.push(typertLoaderFiber);
          await typertLoaderFiber;
        }
        if (this.config.deepseekPluginPackageInventory !== false) {
          const inventoryFiber = this.context.plugin(
            DshPluginPackageInventoryDeepSeek,
            this.config.deepseekPluginPackageInventory ?? {},
          );
          this.fibers.push(inventoryFiber);
          await inventoryFiber;
        }
        const path = asFileUrl(this.config.configFile);
        if (this.config.hmr !== undefined) {
          const debounce = positiveDuration(this.config.hmr.debounceMs ?? 100);
          const base = pathToFileURL(`${dirname(fileURLToPath(path))}/`).href;
          await this.context.plugin(Timer);
          await this.context.plugin(Hmr, {
            base,
            root: [...(this.config.hmr.roots ?? ["."])],
            ignored: [...(this.config.hmr.ignored ?? ["**/node_modules", "**/.*", "cache", "data"])],
            debounce,
          });
        }
        await this.context.loader.create({ name: "cordis:include", config: { path } });
        // The include owns the deployment file base from here on. Restore the
        // host base before concurrently starting agent-scoped compositions.
        if (this.config.agentPresets !== undefined && this.config.agentPresets !== false) this.context.baseUrl = import.meta.url;
        await this.context.loader.await();
      }
      if (this.context.get("loader") !== undefined && this.context.get("pluginInventory") === undefined) new DshPluginInventory(this.context);
      await withTimeout(
        Promise.all(this.fibers.map((fiber) => Promise.resolve(fiber))),
        startupTimeoutMs,
        `DSH plugin initialization did not settle within ${startupTimeoutMs}ms`,
      );
      const officialPresets = this.context.get("agentPresets") as { remoteExportList?: () => Promise<unknown> } | undefined;
      const registry = this.context.get("agents") as SealAgentRegistryBridge | undefined;
      if (officialPresets?.remoteExportList !== undefined && registry !== undefined && this.agentPresets?.registerAuthority !== undefined) {
        const toolBridge = this.context.get("tools") as SealToolRuntimeBridge | undefined;
        const dispose = this.agentPresets.registerAuthority({
          resolve: async (id) => {
            const exported = await (toolBridge?.captureComposition(undefined, () => officialPresets.remoteExportList!()) ?? officialPresets.remoteExportList!());
            if (typeof exported !== "object" || exported === null || !Array.isArray((exported as { presets?: unknown }).presets)) return undefined;
            const row = (exported as { presets: unknown[] }).presets.find((candidate) => typeof candidate === "object" && candidate !== null && (candidate as { id?: unknown }).id === id);
            if (typeof row !== "object" || row === null) return undefined;
            const value = row as { id: string; name?: unknown; description?: unknown; isDefault?: unknown; broken?: unknown };
            return { id: value.id, name: typeof value.name === "string" ? value.name : value.id, ...(typeof value.description === "string" ? { description: value.description } : {}), isDefault: value.isDefault === true, ...(typeof value.broken === "string" ? { broken: value.broken } : {}) } satisfies AgentPresetRow;
          },
          prepare: async (session, preset) => registry.ensurePreset(session.id, preset),
        });
        this.#externalDisposers.add(dispose);
      }
      if (this.context.get("sessionController") === undefined) {
        this.fibers.push(this.context.plugin(DshSessionController, {}));
      }
      if (this.context.get("workspaceController") === undefined && this.context.get("workspaceRegistry") !== undefined) {
        this.fibers.push(this.context.plugin(DshWorkspaceController));
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    await this.context.fiber.dispose();
    const disposers = [...this.#externalDisposers];
    this.#externalDisposers.clear();
    await Promise.allSettled(disposers.map(async (dispose) => { await dispose(); }));
  }

  observeSealRuntime(sessionId: import("@seal-harness/core").SessionId, event: import("@seal-harness/core").RuntimeEvent): void {
    const registry = this.context.get("agents") as SealAgentRegistryBridge | undefined;
    if (registry === undefined) return;
    if (event.type === "run_start") registry.setStatus(sessionId, "running");
    else if (event.type === "run_end") registry.setStatus(sessionId, "idle");
    else if (event.type === "inbox_spliced") registry.notifyInbox(sessionId, event);
    else if (event.type === "run_error") registry.notifyError(sessionId, event.step, event.error);
  }

  observeSealSession(sessionId: import("@seal-harness/core").SessionId, events: readonly import("@seal-harness/core").StoredSessionEvent[]): void {
    (this.context.get("agents") as SealAgentRegistryBridge | undefined)?.observeSession(sessionId, events);
  }

  private hasSealTool(name: string): boolean {
    return this.tools?.definitions(undefined, { includeHidden: true }).some((tool) => tool.name === name) ?? false;
  }
}

function trackConnectionRegistrations(service: unknown, owned: Set<() => unknown>): unknown {
  if (typeof service !== "object" || service === null) return service;
  const target = service as Record<PropertyKey, unknown>;
  const containers = new Map<PropertyKey, unknown>();
  const trackedContainer = (key: PropertyKey, value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    const cached = containers.get(key); if (cached !== undefined) return cached;
    const container = value as Record<PropertyKey, unknown>;
    const wrapped = new Proxy(container, { get(inner, property) {
      const member = Reflect.get(inner, property, inner);
      if ((key === "fetch" && property === "register") || (key === "rpc" && (property === "handle" || property === "intercept"))) {
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const original = member.apply(inner, args) as unknown;
          if (typeof original !== "function") return original;
          let active = true;
          const dispose = async (): Promise<void> => { if (!active) return; active = false; owned.delete(dispose); await original(); };
          owned.add(dispose);
          return dispose;
        };
      }
      return typeof member === "function" ? member.bind(inner) : member;
    } });
    containers.set(key, wrapped); return wrapped;
  };
  return new Proxy(target, { get(inner, property) {
    const value = Reflect.get(inner, property, inner);
    if (property === "fetch" || property === "rpc") return trackedContainer(property, value);
    return typeof value === "function" ? value.bind(inner) : value;
  } });
}

function asFileUrl(value: string): string {
  if (/^file:/i.test(value)) return new URL(value).href;
  return pathToFileURL(resolve(value)).href;
}

export const dshCompatPlugin = definePlugin<DshCompatConfig, SealHarnessEvents>({
  name: "dsh-compat",
  provides: [dshCompatServiceToken],
  optional: [toolServiceToken, contextServiceToken, agentServiceToken, sessionStoreToken, modelServiceToken, subagentServiceToken, attachmentServiceToken, sandboxServiceToken, credentialServiceToken, approvalServiceToken, userQuestionServiceToken, jobServiceToken, settingsServiceToken, messageFeedbackServiceToken, lspServiceToken, agentPresetServiceToken],
  async setup(context, config) {
    const runtime = new DshCompatRuntime(
      context.has(toolServiceToken) ? context.use(toolServiceToken) : undefined,
      config,
      context.has(contextServiceToken) ? context.use(contextServiceToken) : undefined,
      context.has(agentServiceToken) ? context.use(agentServiceToken) : undefined,
      context.has(sessionStoreToken) ? context.use(sessionStoreToken) : undefined,
      context.has(modelServiceToken) ? context.use(modelServiceToken) : undefined,
      context.has(subagentServiceToken) ? context.use(subagentServiceToken) : undefined,
      context.has(attachmentServiceToken) ? context.use(attachmentServiceToken) : undefined,
      context.has(sandboxServiceToken) ? context.use(sandboxServiceToken) : undefined,
      context.has(credentialServiceToken) ? context.use(credentialServiceToken) : undefined,
      context.has(approvalServiceToken) ? context.use(approvalServiceToken) : undefined,
      context.has(userQuestionServiceToken) ? context.use(userQuestionServiceToken) : undefined,
      context.has(jobServiceToken) ? context.use(jobServiceToken) : undefined,
      context.has(settingsServiceToken) ? context.use(settingsServiceToken) : undefined,
      context.has(messageFeedbackServiceToken) ? context.use(messageFeedbackServiceToken) : undefined,
      context.has(lspServiceToken) ? context.use(lspServiceToken) : undefined,
      context.has(agentPresetServiceToken) ? context.use(agentPresetServiceToken) : undefined,
    );
    context.on("runtime.event", ({ sessionId, event }) => runtime.observeSealRuntime(sessionId, event));
    context.on("session.appended", ({ sessionId, events }) => runtime.observeSealSession(sessionId, events));
    await runtime.start();
    context.provide(dshCompatServiceToken, runtime);
    return () => runtime.stop();
  },
});

interface DshToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly timeoutMs?: number;
  readonly output: {
    readonly schema: unknown;
    render(argumentsValue: unknown, value: unknown): readonly unknown[];
    presentationMeta?(argumentsValue: unknown, value: unknown): unknown;
  };
  execute(argumentsValue: unknown, context: DshToolRunContext): Promise<unknown>;
  finalizeContent?(
    context: Readonly<DshToolRunContext>,
    result: Readonly<DshToolExecutionResult>,
  ): readonly unknown[] | undefined;
}

interface DshToolRunContext {
  readonly callId: string;
  readonly rootCallId: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly signal: AbortSignal;
  readonly token: symbol;
  readonly agent?: CompatibleAgent;
  deferContext(message: unknown): void;
  concludeTurn(): void;
}

type DshToolExecutionResult =
  | {
      readonly isError: false;
      readonly value: unknown;
      readonly content: readonly ContentBlock[];
      readonly meta?: JsonValue;
      readonly additionalContexts?: readonly unknown[];
      readonly concludesTurn?: true;
    }
  | {
      readonly isError: true;
      readonly error: { readonly message: string; readonly info?: { readonly name: string } };
      readonly content: readonly ContentBlock[];
      readonly additionalContexts?: readonly unknown[];
    };

class SealLspBridge extends CordisService {
  constructor(context: CordisContext, private readonly seal: LspService) { super(context, "lsp"); }

  registerProvider(provider: DshLspProvider): () => void {
    try {
      return this.seal.registerProvider(provider);
    } catch (error) {
      throw asDshLspError(error);
    }
  }

  async query(request: DshLspQueryRequest, signal?: AbortSignal): Promise<DshLspQueryResult> {
    try {
      return await this.seal.query(request, signal);
    } catch (error) {
      throw asDshLspError(error);
    }
  }
}

function asDshLspError(error: unknown): unknown {
  if (error instanceof DshLspError) return error;
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new DshLspError(error.message, error.code, { cause: error });
  }
  return error;
}

interface ToolBridgeOptions {
  readonly defaultRisk: ToolRisk;
  readonly risks: Readonly<Record<string, ToolRisk>>;
  readonly presentation: "native" | "ptc" | "both";
  readonly maxParallelCodeCalls: number;
}

class SealSandboxProvider extends DshSandboxProvider {
  constructor(context: CordisContext, private readonly seal: SandboxService) { super(context); }
  override confine(argv: readonly string[], policy: any): any {
    return this.seal.confine(argv, { mode: policy.mode, workspaceRoot: policy.workspaceRoot, ...(policy.sessionId === undefined ? {} : { sessionId: String(policy.sessionId) as never }) });
  }
}

class SealCredentialProvider extends DshCredentialProvider {
  constructor(context: CordisContext, private readonly seal: CredentialService) {
    super(context);
    const dispose = seal.subscribe?.((change) => {
      if (change.kind === "reference") this.notifyUpdated(change.reference as any);
      else this.notifyRecordUpdated(change.key as any);
    });
    if (dispose !== undefined) context.effect(() => dispose);
  }
  override async resolve(ref: any): Promise<any> {
    const value = await this.seal.resolveRef?.(String(ref));
    return value === undefined ? undefined : { value, source: "seal" };
  }
  override async describe(ref: any): Promise<any> {
    const described = await this.seal.describeRef?.(String(ref));
    if (described !== undefined) return described;
    const resolved = await this.resolve(ref);
    return { configured: resolved !== undefined, ...(resolved === undefined ? {} : { source: "seal" }), writable: false };
  }
  override async set(ref: any, value: string): Promise<void> {
    if (this.seal.setRef === undefined) throw new Error("Seal credential provider is read-only");
    await this.seal.setRef(String(ref), value);
  }
  override async unset(ref: any): Promise<void> {
    if (this.seal.unsetRef === undefined) throw new Error("Seal credential provider is read-only");
    await this.seal.unsetRef(String(ref));
  }
  override async readRecord(key: any): Promise<any> { return this.seal.readRecord?.(String(key)); }
  override async describeRecord(key: any): Promise<any> {
    return await this.seal.describeRecord?.(String(key)) ?? { configured: false, writable: false };
  }
  override async listRecords(): Promise<readonly any[]> { return await this.seal.listRecords?.() ?? []; }
  override async modifyRecord(key: any, mutate: any): Promise<any> {
    if (this.seal.modifyRecord === undefined) throw new Error("Seal credential provider does not support credential records");
    return this.seal.modifyRecord(String(key), mutate);
  }
  override async deleteRecord(key: any): Promise<void> {
    if (this.seal.deleteRecord === undefined) throw new Error("Seal credential provider does not support credential records");
    await this.seal.deleteRecord(String(key));
  }
}

class SealMessageFeedbackBridge extends TypertRemoteService {
  constructor(context: CordisContext, private readonly seal: MessageFeedbackService) { super(context, "messageFeedback"); }

  async list(request: { readonly sessionId: string }): Promise<any> {
    try { return { ok: true, value: { items: (await this.seal.list(request.sessionId as never)).map(dshFeedbackItem) } }; }
    catch (error) { return feedbackFailure(error, request, this.seal.maxNoteBytes); }
  }

  async put(request: { readonly sessionId: string; readonly messageId: string; readonly rating: "positive" | "negative"; readonly note?: string; readonly ifVersion: string | null }): Promise<any> {
    try {
      const item = await this.seal.put({ sessionId: request.sessionId as never, messageId: request.messageId, rating: request.rating === "positive" ? "up" : "down", ...(request.note === undefined ? {} : { note: request.note }), ifVersion: request.ifVersion });
      return { ok: true, value: dshFeedbackItem(item) };
    } catch (error) { return feedbackFailure(error, request, this.seal.maxNoteBytes); }
  }

  async delete(request: { readonly sessionId: string; readonly messageId: string; readonly ifVersion: string | null }): Promise<any> {
    try { await this.seal.delete({ sessionId: request.sessionId as never, messageId: request.messageId, ifVersion: request.ifVersion }); return { ok: true, value: { absent: true } }; }
    catch (error) { return feedbackFailure(error, request, this.seal.maxNoteBytes); }
  }
}

for (const name of ["list", "put", "delete"] as const) markRemoteMethod(SealMessageFeedbackBridge.prototype, name);

function markRemoteMethod(prototype: Record<string, any>, name: string): void {
  const initializers: Array<(this: object) => void> = [];
  (Remote(name) as any)(prototype[name], {
    kind: "method", name, static: false, private: false,
    access: { has: (value: object) => name in value, get: (value: Record<string, any>) => value[name] },
    addInitializer: (initializer: (this: object) => void) => initializers.push(initializer),
  });
  const receiver = Object.create(prototype) as object;
  for (const initialize of initializers) initialize.call(receiver);
}

function dshFeedbackItem(item: MessageFeedbackItem): Readonly<Record<string, unknown>> {
  return Object.freeze({ messageId: item.messageId, rating: item.rating === "up" ? "positive" : "negative", ...(item.note === undefined ? {} : { note: item.note }), version: item.version, createdAt: Date.parse(item.createdAt) || 0, updatedAt: Date.parse(item.updatedAt) || 0 });
}

function feedbackFailure(error: unknown, request: { readonly sessionId: string; readonly messageId?: string; readonly note?: string }, maxNoteBytes?: number): any {
  if (!(error instanceof MessageFeedbackError)) throw error;
  const common = { sessionId: request.sessionId };
  if (error.code === "SESSION_NOT_FOUND") return { ok: false, error: { code: "session-not-found", ...common } };
  if (error.code === "TARGET_NOT_FOUND") return { ok: false, error: { code: "target-not-found", ...common, messageId: request.messageId } };
  if (error.code === "VERSION_CONFLICT") return { ok: false, error: { code: "version-conflict", current: error.current === null || error.current === undefined ? null : dshFeedbackItem(error.current) } };
  if (error.code === "NOTE_BLANK") return { ok: false, error: { code: "note-blank" } };
  if (error.code === "NOTE_TOO_LARGE") return { ok: false, error: { code: "note-too-large", maxBytes: maxNoteBytes ?? 0, actualBytes: Buffer.byteLength(request.note ?? "", "utf8") } };
  throw error;
}

class SealAttachmentStore extends DshAttachmentStore {
  readonly imageLimits;
  private readonly requestInflight = new Map<string, Promise<any>>();

  constructor(context: CordisContext, private readonly seal: AttachmentService) {
    super(context);
    const configured = seal.imageLimits;
    this.imageLimits = Object.freeze({
      maxImageBytes: configured?.maxImageBytes ?? 10 * 1024 * 1024,
      maxImagesPerMessage: configured?.maxImagesPerMessage ?? 20,
      maxMessageImageBytes: configured?.maxMessageImageBytes ?? 10 * 1024 * 1024,
      maxImagePixels: configured?.maxImagePixels ?? 64_000_000,
      maxImageDimension: configured?.maxImageDimension ?? 8192,
      mediaTypes: (configured?.mediaTypes ?? ["image/png", "image/jpeg", "image/webp", "image/gif"]).filter(isDshImageMediaType),
    });
  }

  async validateImage(input: DshSaveImageAttachment): Promise<void> { await this.inspect(input); }

  async saveImage(input: DshSaveImageAttachment): Promise<DshImageAttachmentRef> {
    const metadata = await this.inspect(input);
    const stored = await this.seal.put({ data: input.data, mimeType: input.mediaType, ...(input.name === undefined ? {} : { name: input.name }) });
    const mediaType = stored.mimeType !== undefined && isDshImageMediaType(stored.mimeType) ? stored.mimeType : input.mediaType;
    const width = stored.width ?? metadata.width; const height = stored.height ?? metadata.height;
    return { attachmentId: DshAttachmentId(stored.id), mediaType, bytes: stored.bytes ?? input.data.byteLength, width, height, ...(stored.name === undefined ? {} : { name: stored.name }), ...(stored.originalDimensions === undefined ? {} : { originalDimensions: { ...stored.originalDimensions } }) };
  }

  async readImage(ref: DshImageAttachmentRef, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    const stored = await this.seal.get({ type: "attachment", id: String(ref.attachmentId), mimeType: ref.mediaType, ...(ref.name === undefined ? {} : { name: ref.name }) });
    if (stored === undefined) throw new Error(`Attachment not found: ${String(ref.attachmentId)}`);
    signal?.throwIfAborted();
    return { ref, data: stored.data };
  }

  override async readImageRequest(ref: DshImageAttachmentRef, policy: DshImageRequestPolicy, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(policy.maxPixels) || policy.maxPixels <= 0 || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) throw new Error("Image request limits must be positive integers");
    if (this.seal.readImageRequest !== undefined) {
      const request = await this.seal.readImageRequest({ type: "attachment", id: String(ref.attachmentId), mimeType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height, ...(ref.name === undefined ? {} : { name: ref.name }), ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { ...ref.originalDimensions } }) }, policy, signal);
      if (!isDshImageMediaType(request.mimeType)) throw new Error(`Unsupported request image type: ${request.mimeType}`);
      return { variantId: DshImageVariantId(request.variantId), attachment: ref, data: request.data, mediaType: request.mimeType, bytes: request.bytes, width: request.width, height: request.height, depth: request.depth, space: request.space, hasAlpha: request.hasAlpha };
    }
    const variant = createHash("sha256").update(JSON.stringify({ transformVersion: "request-image-v5", attachmentId: ref.attachmentId, routePixelBudget: policy.maxPixels, encodedByteBudget: policy.maxBytes, encoding: { webpQualities: [85, 75, 60], webpEffort: 0, jpegQualities: [85, 75, 60], order: ["alpha:webp", "opaque:jpeg"], colourspace: "srgb" } })).digest("hex");
    const variantId = DshImageVariantId(`sha256:${variant}`); const key = String(variantId);
    let operation = this.requestInflight.get(key);
    if (operation === undefined) {
      operation = this.createRequestImage(ref, policy, variantId);
      this.requestInflight.set(key, operation);
      void operation.finally(() => { if (this.requestInflight.get(key) === operation) this.requestInflight.delete(key); }).catch(() => {});
    }
    return waitForSharedRequest(operation, signal);
  }

  private async createRequestImage(ref: DshImageAttachmentRef, policy: DshImageRequestPolicy, variantId: ReturnType<typeof DshImageVariantId>): Promise<any> {
    const stored = await this.readImage(ref);
    const source = await sharp(stored.data, { failOn: "error", limitInputPixels: false }).metadata();
    const hasAlpha = Boolean(source.hasAlpha); const dimensions = requestImageDimensions(ref.width, ref.height, policy.maxPixels);
    let data = stored.data; let mediaType = ref.mediaType; let width = ref.width; let height = ref.height; let resultHasAlpha = hasAlpha;
    if (dimensions.width !== ref.width || dimensions.height !== ref.height || data.byteLength > policy.maxBytes) {
      const pipeline = sharp(stored.data, { failOn: "error", limitInputPixels: false }).toColourspace("srgb").resize({ ...dimensions, fit: "inside", withoutEnlargement: true });
      let smallest: { data: Uint8Array; mediaType: DshImageMediaType; width: number; height: number } | undefined;
      for (const quality of [85, 75, 60]) {
        const encoded = hasAlpha ? await pipeline.clone().webp({ quality, effort: 0 }).toBuffer({ resolveWithObject: true }) : await pipeline.clone().jpeg({ quality }).toBuffer({ resolveWithObject: true });
        const candidate = { data: new Uint8Array(encoded.data), mediaType: (hasAlpha ? "image/webp" : "image/jpeg") as DshImageMediaType, width: encoded.info.width, height: encoded.info.height };
        if (smallest === undefined || candidate.data.byteLength < smallest.data.byteLength) smallest = candidate;
        if (candidate.data.byteLength <= policy.maxBytes) { smallest = candidate; break; }
      }
      if (smallest === undefined) throw new Error("Image request conversion produced no output");
      data = smallest.data; mediaType = smallest.mediaType; width = smallest.width; height = smallest.height;
      const verified = await sharp(data, { failOn: "error", limitInputPixels: false }).metadata();
      if (verified.width !== width || verified.height !== height || verified.depth !== "uchar" || verified.space !== "srgb" || (verified.format === "jpeg" ? "image/jpeg" : verified.format === "webp" ? "image/webp" : undefined) !== mediaType) throw new Error("Encoded model-request image does not match its metadata");
      resultHasAlpha = Boolean(verified.hasAlpha);
      if (resultHasAlpha !== hasAlpha && !(hasAlpha && !resultHasAlpha && mediaType === "image/webp")) throw new Error("Encoded model-request image changed alpha semantics");
    }
    return { variantId, attachment: ref, data, mediaType, bytes: data.byteLength, width, height, depth: "uchar", space: "srgb", hasAlpha: resultHasAlpha };
  }

  private async inspect(input: DshSaveImageAttachment): Promise<{ width: number; height: number }> {
    if (input.data.byteLength > this.imageLimits.maxImageBytes) throw new Error("Image exceeds the configured byte limit");
    if (!this.imageLimits.mediaTypes.includes(input.mediaType)) throw new Error(`Unsupported image type: ${input.mediaType}`);
    const pipeline = sharp(input.data, { failOn: "error", limitInputPixels: false }); const metadata = await pipeline.metadata();
    const mediaType = metadata.format === "png" ? "image/png" : metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : metadata.format === "gif" ? "image/gif" : undefined;
    if (mediaType !== input.mediaType) throw new Error(`Declared image type ${input.mediaType} does not match ${mediaType ?? "unsupported bytes"}`);
    const transposed = metadata.orientation !== undefined && metadata.orientation >= 5; const width = transposed ? metadata.height : metadata.width; const height = transposed ? metadata.width : metadata.height;
    if (!width || !height) throw new Error("Image dimensions are unavailable");
    if (width > this.imageLimits.maxImageDimension || height > this.imageLimits.maxImageDimension || width * height > this.imageLimits.maxImagePixels) throw new Error("Image exceeds the configured dimension limit");
    await pipeline.clone().raw().toBuffer();
    return { width, height };
  }
}

function isDshImageMediaType(value: string): value is DshImageMediaType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif";
}

function requestImageDimensions(width: number, height: number, maxPixels: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  if (scale === 1) return { width, height };
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.floor(width * scale)); let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width));
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) { projectedWidth -= 1; projectedHeight = Math.max(1, Math.round(projectedWidth * height / width)); }
    return { width: projectedWidth, height: projectedHeight };
  }
  let projectedHeight = Math.max(1, Math.floor(height * scale)); let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height));
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) { projectedHeight -= 1; projectedWidth = Math.max(1, Math.round(projectedHeight * width / height)); }
  return { width: projectedWidth, height: projectedHeight };
}

function waitForSharedRequest<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolveRequest, rejectRequest) => {
    let settled = false;
    const finish = (settle: () => void): void => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); settle(); };
    const abort = (): void => { finish(() => rejectRequest(signal.reason instanceof Error ? signal.reason : new Error("Attachment request cancelled", { cause: signal.reason }))); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void operation.then((value) => { finish(() => resolveRequest(value)); }, (error: unknown) => { finish(() => rejectRequest(error)); });
  });
}

function imageHeader(data: Uint8Array): { mediaType: DshImageMediaType; width: number; height: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { mediaType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  if (data.length >= 10 && String.fromCharCode(...data.subarray(0, 3)) === "GIF") return { mediaType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (data.length >= 30 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...data.subarray(12, 16));
    if (kind === "VP8X") return { mediaType: "image/webp", width: 1 + data[24]! + (data[25]! << 8) + (data[26]! << 16), height: 1 + data[27]! + (data[28]! << 8) + (data[29]! << 16) };
    if (kind === "VP8 " && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) return { mediaType: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L" && data[20] === 0x2f) { const bits = view.getUint32(21, true); return { mediaType: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1]!; if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = view.getUint16(offset + 2); if (length < 2 || offset + 2 + length > data.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) return { mediaType: "image/jpeg", height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  }
  throw new Error("Unsupported or malformed image data");
}

/** Maps the DSH background-job seam onto Seal's owner-scoped JobService. */
class SealJobRegistry extends DshJobRegistry {
  private readonly metadata = new Map<string, { owner?: CompatibleAgent; outputLimitBytes?: number; reported: boolean }>();
  private readonly doneListeners = new Set<(snapshot: DshJobSnapshot, owner?: CompatibleAgent) => unknown>();

  constructor(context: CordisContext, private readonly seal: JobService) { super(context); }

  override start(spec: any): any {
    const hooks = spec.run();
    const id = this.seal.start({
      kind: String(spec.kind), label: String(spec.label),
      ...(spec.owner === undefined ? {} : { ownerSession: String(spec.owner.id) as never }),
      ...(spec.outputLimitBytes === undefined ? {} : { outputLimitBytes: spec.outputLimitBytes }),
      run: () => ({
        cancel: (reason?: string) => hooks.cancel(reason),
        done: Promise.resolve(hooks.done).then((outcome: any) => ({
          status: outcome.status === "killed" ? "cancelled" : outcome.status,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        })),
        ...(hooks.readOutput === undefined ? {} : { readOutput: () => hooks.readOutput() }),
      }),
    });
    const meta = { ...(spec.owner === undefined ? {} : { owner: spec.owner }), ...(spec.outputLimitBytes === undefined ? {} : { outputLimitBytes: spec.outputLimitBytes }), reported: false };
    this.metadata.set(id, meta);
    void hooks.done.then(() => {
      const snapshot = this.snapshot(this.seal.get(id, spec.owner?.id), id);
      for (const listener of this.doneListeners) { try { void listener(snapshot, spec.owner); } catch { /* listener isolation is part of the DSH registry contract */ } }
    }, () => {});
    return DshJobId(id);
  }

  override list(caller?: any): any[] { return this.seal.list(caller?.id).map((job) => this.snapshot(job, job.id)); }
  override get(id: any, caller?: any): any { return this.snapshot(this.seal.get(String(id), caller?.id), String(id)); }
  override read(id: any, caller?: any): any { const value = this.seal.read(String(id), caller?.id); this.reported(String(id)); return { text: value.output, snapshot: this.snapshot(value.job, String(id)) }; }
  override kill(id: any, caller?: any, reason?: string): "requested" | "already-finished" {
    const current = this.seal.get(String(id), caller?.id); this.reported(String(id));
    if (["completed", "failed", "cancelled"].includes(current.status)) return "already-finished";
    this.seal.cancel(String(id), caller?.id, reason); return "requested";
  }
  override async wait(id: any, timeoutMs: number, caller?: any, signal?: AbortSignal): Promise<any> {
    const result = await this.seal.wait(String(id), timeoutMs, caller?.id, signal);
    if (["completed", "failed", "cancelled"].includes(result.status)) this.reported(String(id));
    return this.snapshot(result, String(id));
  }
  override onJobDone(listener: any): () => void { this.doneListeners.add(listener); return this.ctx.effect(() => () => this.doneListeners.delete(listener)); }
  override onJobsChanged(listener: any): () => void {
    const dispose = this.seal.subscribe?.((ownerSession) => listener(this.metadataForOwner(ownerSession)?.owner));
    return this.ctx.effect(() => () => dispose?.());
  }
  override attachController(_name: string): () => void { return this.ctx.effect(() => () => {}); }

  private reported(id: string): void { const meta = this.metadata.get(id); if (meta !== undefined) meta.reported = true; }
  private metadataForOwner(ownerSession: unknown) { return [...this.metadata.values()].find((meta) => meta.owner?.id === ownerSession); }
  private snapshot(job: import("@seal-harness/core").JobSnapshot, id: string): DshJobSnapshot {
    const meta = this.metadata.get(id);
    return {
      id: DshJobId(job.id), kind: job.kind as any, label: job.label,
      status: job.status === "cancelled" ? "killed" : job.status,
      startedAt: job.startedAt, reported: meta?.reported ?? false,
      ...(job.ownerSession === undefined ? {} : { ownerSession: job.ownerSession as any }),
      ...(job.detail === undefined ? {} : { detail: job.detail }),
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      ...(meta?.outputLimitBytes === undefined ? {} : { outputLimitBytes: meta.outputLimitBytes }),
    };
  }
}

/** Maps DSH's durable child-agent control surface onto Seal's ownership-aware service. */
class SealSubagentRuntime extends DshSubagentRuntime {
  constructor(context: CordisContext, private readonly seal: SubagentService, private readonly agents?: AgentService) {
    super(context);
    this.registerProvider({
      name: "seal",
      capabilities: { outputSchema: true },
      inheritsParentContext: false,
      // The Seal bridge overrides startContinuable() and owns durable creation
      // directly; this provider hook is the official tool's capability marker.
      prepareContinuable: async () => ({}),
      start: async (request: any) => this.startSealRun(request),
    } as any);
    this.registerProvider({
      name: "seal-fork",
      capabilities: { outputSchema: true },
      inheritsParentContext: true,
      start: async (request: any) => this.startSealRun(request, true),
    } as any);
  }

  override async startContinuable(spec: any): Promise<any> {
    spec.signal?.throwIfAborted();
    const snapshot = await this.spawn(spec.request, spec.label, spec.childId);
    spec.signal?.throwIfAborted();
    return { childId: snapshot.sessionId, messageId: messageId(crypto.randomUUID()) };
  }

  override async sendMessage(sender: any, targetId: any, content: any[], options: any): Promise<any> {
    options.signal?.throwIfAborted();
    const senderId = String(sender.id);
    const acceptedId = messageId(crypto.randomUUID());
    const message = { id: acceptedId, role: "user" as const, content: normalizeDshPrompt(content), source: { kind: "agent-message", form: "relay", senderSessionId: senderId } };
    const directParent = sender.session?.header?.parentSession;
    if (directParent === targetId) {
      const execution = this.agents?.active?.(String(targetId) as never);
      if (execution === undefined) throw new Error(`parent agent is not active: ${String(targetId)}`);
      execution.steer(message);
    } else {
      await this.seal.send(senderId as never, String(targetId) as never, message);
    }
    return acceptedId;
  }

  override interrupt(targetSessionId: any, authority: any): void {
    const parentId = authority.kind === "user" ? authority.parentSessionId : authority.agent.id;
    void this.seal.abort(String(parentId) as never, String(targetSessionId) as never, "interrupted by DSH subagent control");
  }

  override async listChildren(parentSessionId: any, signal?: AbortSignal): Promise<any[]> {
    signal?.throwIfAborted();
    const rows = await this.seal.list(String(parentSessionId) as never);
    signal?.throwIfAborted();
    const childIds = new Set(rows.map((row) => String(row.sessionId)));
    const nested = await Promise.all(rows.map((row) => this.seal.list(row.sessionId)));
    return rows.map((row, index) => ({ kind: "child", id: row.sessionId, activity: row.status === "running" ? "running" : "inactive", hasChildren: nested[index]!.some((child) => childIds.has(String(child.sessionId)) || child.parentSessionId === row.sessionId), mode: "continuable", label: row.label }));
  }

  override async listDescendants(rootSessionId: any, signal?: AbortSignal): Promise<any[]> {
    const result: any[] = [];
    const visit = async (parentId: any, depth: number): Promise<void> => {
      for (const row of await this.listChildren(parentId, signal)) {
        result.push({ ...row, parentId, depth });
        await visit(row.id, depth + 1);
      }
    };
    await visit(rootSessionId, 1);
    return result;
  }

  override async remoteExportList(parentSessionId: any, signal: AbortSignal): Promise<any> {
    return { entries: await this.listChildren(parentSessionId, signal), parentAvailable: this.agents?.active?.(String(parentSessionId) as never) !== undefined };
  }

  override async prompt(request: any, signal: AbortSignal): Promise<any> {
    signal.throwIfAborted();
    const acceptedId = messageId(String(request.requestId));
    const content: ContentBlock[] = [];
    const images = request.content.filter((block: any) => block?.type === "image");
    const refs = images.length === 0 ? [] : await (this.ctx.get("attachments") as DshAttachmentStore).saveImages(images.map((block: any) => ({ data: Buffer.from(String(block.data), "base64"), mediaType: block.mediaType, ...(block.name === undefined ? {} : { name: block.name }) })));
    let imageIndex = 0;
    for (const block of request.content) {
      if (block?.type === "text") content.push(text(String(block.text)));
      else if (block?.type === "image") { const ref = refs[imageIndex++]!; content.push({ type: "attachment", id: String(ref.attachmentId), mimeType: ref.mediaType, ...(ref.name === undefined ? {} : { name: ref.name }) }); }
    }
    await this.seal.send(String(request.parentSessionId) as never, String(request.childSessionId) as never, {
      id: acceptedId, role: "user", content,
      source: { kind: "user", requestId: String(request.requestId), ...(request.clientTimeZone === undefined ? {} : { clientTimeZone: request.clientTimeZone }) },
    });
    return { messageId: acceptedId };
  }

  override interruptByParent(childSessionId: any, parentSessionId: any, _mode: "continuable"): any {
    void this.seal.abort(String(parentSessionId) as never, String(childSessionId) as never, "interrupted by DSH browser control");
    return { accepted: true };
  }

  private async startSealRun(request: any, inheritParentContext = false): Promise<any> {
    const snapshot = await this.spawn(request, request.label, undefined, inheritParentContext);
    const result = this.seal.wait(snapshot.parentSessionId, [snapshot.sessionId], 2_147_483_647, request.signal).then((wait) => {
      const settled = wait.completed[0];
      if (settled === undefined) return { output: [], stopReason: "aborted", diagnostic: "subagent wait ended before settlement" };
      return { output: settled.result === undefined ? [] : [{ type: "text", text: settled.result }], ...(settled.structuredResult === undefined ? {} : { structured: settled.structuredResult }), stopReason: settled.status === "completed" ? "completed" : settled.status === "aborted" ? "aborted" : "error", ...(settled.error === undefined ? {} : { diagnostic: settled.error }) };
    });
    return { id: snapshot.sessionId, localAgent: undefined, result, dispose: async () => { await this.seal.abort(snapshot.parentSessionId, snapshot.sessionId, "DSH subagent run disposed"); } };
  }

  private spawn(request: any, label?: string, childId?: string, inheritParentContext = false) {
    const parent = request.parent;
    const options = request.agentOptions ?? parent.options ?? {};
    const model = options.provider !== undefined && options.model !== undefined ? { provider: String(options.provider), model: String(options.model) } : undefined;
    return this.seal.spawn({ ...(childId === undefined ? {} : { sessionId: String(childId) as never }), parentSessionId: String(parent.id) as never, cwd: String(parent.session?.header?.cwd ?? parent.session?.cwd ?? process.cwd()), prompt: normalizeDshPrompt(request.prompt).map((block) => block.type === "text" ? block.text : `[${block.type}]`).join("\n"), ...(label === undefined ? {} : { label }), ...(model === undefined ? {} : { model }), ...(options.reasoningEffort === undefined ? {} : { reasoning: sealReasoning(String(options.reasoningEffort)) }), ...(request.outputSchema === undefined ? {} : { outputSchema: request.outputSchema }), ...(inheritParentContext ? { inheritParentContext: true } : {}) });
  }
}

function normalizeDshPrompt(content: readonly any[]): ContentBlock[] {
  return content.flatMap((block) => block?.type === "text" ? [text(String(block.text))] : block?.type === "image" ? dshContentBlockToSeal(block as any) : []);
}

class SealLlmAdapter extends DshLlmAdapter {
  constructor(private readonly models: ModelService, private readonly catalog: readonly ModelInfo[], private readonly attachments?: DshAttachmentStore) { super(); }

  override providerInfo(provider: string): { id: string; name: string } { return { id: provider, name: provider }; }

  override async listModels(provider: string): Promise<readonly DshModelInfo[]> {
    return this.catalog.filter((model) => model.provider === provider).map((model) => ({
      provider,
      id: model.model,
      name: model.displayName ?? model.model,
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(model.supportsImages === undefined ? {} : { inputModalities: model.supportsImages ? ["text" as const, "image" as const] : ["text" as const] }),
    }));
  }

  override async resolveModel(provider: string, model: string): Promise<DshResolvedModelInfo> {
    const info = await this.models.get({ provider, model });
    return {
      provider, id: model, name: info?.displayName ?? model,
      ...(info === undefined ? {} : { context: { contextWindow: info.contextWindow }, defaultMaxTokens: info.maxOutputTokens, ...(info.description === undefined ? {} : { description: info.description }), ...(info.supportsImages === undefined ? {} : { inputModalities: info.supportsImages ? ["text" as const, "image" as const] : ["text" as const] }), ...(info.supportsReasoning === true ? { reasoning: { efforts: ["off", "low", "medium", "high", "max"].map((id) => ({ id: id as never, name: id })) } } : {}) }),
    };
  }

  override async *stream(options: DshGenerateOptions): AsyncIterable<DshStreamChunk> {
    const signal = options.signal ?? new AbortController().signal;
    const toolNames = new Map<string, string>();
    for (const message of options.messages) {
      if (message.role !== "assistant") continue;
      for (const block of message.content) {
        if (block.type === "tool-call") toolNames.set(String(block.id), block.name);
      }
    }
    const messages = await Promise.all(options.messages.map((message) => dshMessageToSeal(message, toolNames, this.attachments, signal)));
    let active: { kind: "text" | "reasoning"; index: number; value: string } | undefined;
    let nextIndex = 0;
    for await (const event of this.models.stream({
      model: { provider: options.provider, model: options.model }, systemPrompt: options.system ?? "",
      messages, tools: (options.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters as JsonSchema })), signal,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }), ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
      ...(options.stop === undefined ? {} : { stop: [...options.stop] }),
      ...(options.reasoningEffort === undefined ? {} : { reasoning: sealReasoning(String(options.reasoningEffort)) }),
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) as import("@seal-harness/core").SessionId }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    })) {
      if (event.type === "text_delta" || event.type === "reasoning_delta") {
        const kind = event.type === "text_delta" ? "text" : "reasoning";
        if (active?.kind !== kind) {
          if (active !== undefined) yield { type: "block-end", index: active.index, block: { type: active.kind, text: active.value } } as DshStreamChunk;
          active = { kind, index: nextIndex++, value: "" };
          yield { type: "block-start", index: active.index, blockType: kind };
        }
        active.value += event.delta;
        yield kind === "text" ? { type: "text-delta", index: active.index, text: event.delta } : { type: "reasoning-delta", index: active.index, text: event.delta };
      } else if (event.type === "tool_call") {
        if (active !== undefined) {
          yield { type: "block-end", index: active.index, block: { type: active.kind, text: active.value } } as DshStreamChunk;
          active = undefined;
        }
        const index = nextIndex++;
        const argumentsValue = typeof event.call.providerData?.dshArguments === "string"
          ? event.call.providerData.dshArguments
          : JSON.stringify(event.call.arguments);
        yield { type: "block-start", index, blockType: "tool-call" };
        yield { type: "tool-call-delta", index, id: event.call.id as never, name: event.call.name, argumentsDelta: argumentsValue };
        yield { type: "block-end", index, block: { type: "tool-call", id: event.call.id as never, name: event.call.name, arguments: argumentsValue } };
      } else if (event.type === "usage") {
        if (active !== undefined) {
          yield { type: "block-end", index: active.index, block: { type: active.kind, text: active.value } } as DshStreamChunk;
          active = undefined;
        }
        yield { type: "usage", usage: {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          totalTokens: event.usage.totalTokens ?? event.usage.inputTokens + event.usage.outputTokens + (event.usage.cacheReadTokens ?? 0) + (event.usage.cacheWriteTokens ?? 0),
          ...(event.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: event.usage.cacheReadTokens }),
          ...(event.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: event.usage.cacheWriteTokens }),
          ...(event.usage.reasoningTokens === undefined ? {} : { reasoningTokens: event.usage.reasoningTokens }),
        } };
      } else if (event.type === "done") {
        if (active !== undefined) {
          yield { type: "block-end", index: active.index, block: { type: active.kind, text: active.value } } as DshStreamChunk;
          active = undefined;
        }
        const reason = event.stopReason === "tool_call" ? { kind: "tool-calls" as const } : event.stopReason === "length" ? { kind: "max-tokens" as const } : event.stopReason === "aborted" ? { kind: "aborted" as const, failure: { message: "model request aborted", code: "ABORTED" } } : event.stopReason === "error" ? { kind: "error" as const, failure: { message: "model request failed", code: "MODEL_ERROR" } } : { kind: "stop" as const };
        const replayable = event.stopReason !== "aborted" && event.stopReason !== "error";
        yield { type: "finish", reason, ...(!replayable || event.replayState === undefined ? {} : { replayState: event.replayState }) };
      }
    }
  }
}

async function dshMessageToSeal(message: DshGenerateOptions["messages"][number], toolNames: ReadonlyMap<string, string>, attachments: DshAttachmentStore | undefined, signal: AbortSignal): Promise<import("@seal-harness/core").AgentMessage> {
  if (message.role === "assistant") {
    const source = message.source as unknown as Record<string, unknown>;
    const replay = typeof source.replayState === "object" && source.replayState !== null && !Array.isArray(source.replayState) ? source.replayState as Record<string, unknown> : undefined;
    const replayBlocksValue = replay?.blocks;
    const validReplay = replay !== undefined && (replayBlocksValue === undefined || (Array.isArray(replayBlocksValue) && replayBlocksValue.length === message.content.length));
    const replayBlocks = validReplay && Array.isArray(replayBlocksValue) ? replayBlocksValue : [];
    const content = await Promise.all(message.content.map(async (block, blockIndex): Promise<import("@seal-harness/core").AssistantContentBlock[]> => {
      const replayBlock = typeof replayBlocks[blockIndex] === "object" && replayBlocks[blockIndex] !== null && !Array.isArray(replayBlocks[blockIndex]) ? replayBlocks[blockIndex] as JsonObject : undefined;
      if (block.type === "text" || block.type === "reasoning") return [{ type: block.type, text: block.text }];
      if (block.type === "tool-call") { let args: JsonObject = {}; try { const parsed: unknown = JSON.parse(block.arguments); if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) args = parsed as JsonObject; } catch {} return [{ type: "tool_call", id: toolCallId(block.id), name: block.name, arguments: args, providerData: { ...replayBlock, dshArguments: block.arguments } }]; }
      if (block.type === "image") return dshModelImageToSeal(block, attachments, signal);
      return [];
    }));
    const response = validReplay && typeof replay.response === "object" && replay.response !== null && !Array.isArray(replay.response) ? replay.response as JsonObject : undefined;
    const replayState = validReplay ? { response: toJsonValue(replay.response), ...(replayBlocksValue === undefined ? {} : { blocks: replayBlocks.map(toJsonValue) }) } : undefined;
    return { role: "assistant", content: content.flat().map((block, index) => block.type === "reasoning" && typeof replayBlocks[index] === "object" && replayBlocks[index] !== null && !Array.isArray(replayBlocks[index]) ? { ...block, providerData: replayBlocks[index] as JsonObject } : block), ...(response === undefined ? {} : { providerData: response }), ...(replayState === undefined ? {} : { replayState }) };
  }
  const toolBlock = message.content.find((block) => block.type === "tool-result");
  if (toolBlock?.type === "tool-result") {
    const content = await Promise.all(toolBlock.content.map((block) => dshModelContentBlockToSeal(block, attachments, signal)));
    return { role: "tool", callId: toolCallId(toolBlock.toolCallId), name: toolNames.get(String(toolBlock.toolCallId)) ?? "tool", content: content.flat(), isError: toolBlock.isError === true };
  }
  const source = toJsonValue(message.source);
  const content = await Promise.all(message.content.map((block) => dshModelContentBlockToSeal(block, attachments, signal)));
  return { id: message.id as never, role: "user", content: content.flat(), ...(typeof source === "object" && source !== null && !Array.isArray(source) ? { source: source as JsonObject } : {}) };
}

async function dshModelContentBlockToSeal(block: DshGenerateOptions["messages"][number]["content"][number], attachments: DshAttachmentStore | undefined, signal: AbortSignal): Promise<ContentBlock[]> {
  if (block.type === "image") return dshModelImageToSeal(block, attachments, signal);
  return dshContentBlockToSeal(block);
}

async function dshModelImageToSeal(block: Extract<DshGenerateOptions["messages"][number]["content"][number], { type: "image" }>, attachments: DshAttachmentStore | undefined, signal: AbortSignal): Promise<import("@seal-harness/core").ImageBlock[] | import("@seal-harness/core").AttachmentBlock[]> {
  if (attachments === undefined) return dshContentBlockToSeal(block) as import("@seal-harness/core").AttachmentBlock[];
  const stored = await attachments.readImage(block.attachment, signal);
  return [{ type: "image", data: Buffer.from(stored.data).toString("base64"), mimeType: block.attachment.mediaType }];
}

function dshContentBlockToSeal(block: DshGenerateOptions["messages"][number]["content"][number]): ContentBlock[] {
  if (block.type === "text") return [text(block.text)];
  if (block.type === "image") { const attachment = block.attachment as unknown as Record<string, unknown>; return [{ type: "attachment", id: String(attachment.id ?? attachment.attachmentId ?? "image"), ...(typeof attachment.name === "string" ? { name: attachment.name } : {}), ...(typeof attachment.mediaType === "string" ? { mimeType: attachment.mediaType } : {}) }]; }
  return [];
}

class SealToolRuntimeBridge extends CordisService {
  protected readonly definitionsByName = new Map<string, Array<{ definition: DshToolDefinition; ownerSession?: import("@seal-harness/core").SessionId; scope?: object; deferred?: true }>>();
  private readonly agentBindings = new Map<import("@seal-harness/core").SessionId, Array<() => void>>();
  private readonly compositionCapture = new AsyncLocalStorage<Array<{ scope?: object }>>();
  private readonly presentationByScope = new Map<object, "native" | "ptc" | "both">();
  private ptcInfrastructureInstalled = false;
  constructor(
    private readonly rootContext: CordisContext,
    readonly tools: ToolService,
    readonly options: ToolBridgeOptions,
    private readonly contexts?: ContextService,
  ) {
    super(rootContext, "tools");
    if (options.presentation !== "native") this.ensurePtcInfrastructure();
  }

  presentAs(mode: "native" | "ptc" | "both"): () => void {
    const caller = this.ctx;
    const scope = dshScopeOf(caller);
    if (scope === undefined) throw new Error("tools.presentAs() requires a scoped context (agent.ctx)");
    if (this.presentationByScope.has(scope)) throw new Error(`tools.presentAs("${mode}") conflicts with another presentation already declared for this scope`);
    if (mode !== "native") this.ensurePtcInfrastructure();
    this.presentationByScope.set(scope, mode);
    return caller.effect(() => () => { if (this.presentationByScope.get(scope) === mode) this.presentationByScope.delete(scope); });
  }

  private modeFor(sessionId?: import("@seal-harness/core").SessionId): "native" | "ptc" | "both" {
    const agent = sessionId === undefined ? undefined : (this.rootContext.get("agents") as { get?(id: string): CompatibleAgent | undefined } | undefined)?.get?.(String(sessionId));
    const scope = agent === undefined ? undefined : dshScopeOf(agent.ctx);
    for (const key of dshScopeChainOf(scope)) {
      const mode = this.presentationByScope.get(key);
      if (mode !== undefined) return mode;
    }
    return this.options.presentation;
  }

  private ensurePtcInfrastructure(): void {
    if (this.ptcInfrastructureInstalled) return;
    if (this.tools.filterModelDefinitions === undefined) throw new Error("PTC presentation requires ToolService.filterModelDefinitions()");
    const disposers: Array<() => void> = [];
    try {
      disposers.push(this.tools.register(createRunCodeBridge(this.rootContext, this.tools, this.options)));
      disposers.push(this.tools.filterModelDefinitions((definition, sessionId) => {
        const mode = this.modeFor(sessionId);
        if (mode === "native") return definition.name !== "run_code";
        if (mode === "ptc") return definition.name === "run_code";
        return true;
      }));
      if (this.contexts !== undefined) disposers.push(this.contexts.register({ name: "dsh-ptc-sdk", contribute: async (request) => {
        const mode = this.modeFor(request.sessionId);
        if (mode === "native") return undefined;
        const schemas = this.tools.definitions(request.sessionId, { includeHidden: true }).filter((definition) => definition.name !== "run_code").map((definition) => ({ name: definition.name, description: definition.description, parameters: definition.inputSchema, output: {} }));
        const sdk = renderToolsSdk(schemas);
        const rule = mode === "ptc" ? "`run_code` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.\n\n" : "";
        return { systemPrompt: `${rule}${sdk}` };
      } }));
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      throw error;
    }
    this.ptcInfrastructureInstalled = true;
    this.rootContext.effect(() => () => { for (const dispose of disposers.reverse()) dispose(); });
  }

  register(definition: unknown, ownerSession?: import("@seal-harness/core").SessionId): () => void {
    ownerSession ??= scopedSessionId(this.ctx);
    const dshTool = assertDshTool(definition);
    const scope = dshScopeOf(this.ctx) as object | undefined;
    const capture = this.compositionCapture.getStore();
    const deferred = ownerSession === undefined && (scope !== undefined || capture !== undefined);
    const entries = this.definitionsByName.get(dshTool.name) ?? [];
    if (entries.some((entry) => entry.ownerSession === ownerSession && entry.scope === scope)) throw new Error(`DSH Tool is already registered in this scope: ${dshTool.name}`);
    const entry = { definition: dshTool, ...(ownerSession === undefined ? {} : { ownerSession }), ...(scope === undefined ? {} : { scope }), ...(deferred ? { deferred: true as const } : {}) };
    capture?.push(entry);
    entries.push(entry); this.definitionsByName.set(dshTool.name, entries);
    const disposeTool = deferred ? undefined : this.tools.register(adaptDshTool(this.ctx, dshTool, this.options), ownerSession === undefined ? {} : { ownerSession });
    return this.ctx.effect(() => () => { disposeTool?.(); const current = this.definitionsByName.get(dshTool.name); if (current === undefined) return; const index = current.indexOf(entry); if (index >= 0) current.splice(index, 1); if (current.length === 0) this.definitionsByName.delete(dshTool.name); });
  }

  bindAgent(agent: CompatibleAgent): void {
    const ownerSession = agent.id as import("@seal-harness/core").SessionId;
    for (const dispose of this.agentBindings.get(ownerSession) ?? []) dispose();
    const chain = dshScopeChainOf(dshScopeOf(agent.ctx)); const disposers: Array<() => void> = [];
    for (const entries of this.definitionsByName.values()) {
      const selected = chain.map((scope) => entries.find((entry) => entry.deferred === true && entry.scope === scope)).find((entry) => entry !== undefined);
      if (selected !== undefined) disposers.push(this.tools.register(adaptDshTool(agent.ctx, selected.definition, this.options), { ownerSession }));
    }
    this.agentBindings.set(ownerSession, disposers);
  }

  async captureComposition<T>(agent: CompatibleAgent | undefined, work: () => Promise<T>): Promise<T> {
    const captured: Array<{ scope?: object }> = [];
    const result = await this.compositionCapture.run(captured, work);
    const standing = agent === undefined ? undefined : dshScopeChainOf(dshScopeOf(agent.ctx))[1];
    if (standing !== undefined) for (const entry of captured) entry.scope = standing;
    return result;
  }

  get(name: string, agent?: { readonly id?: string }): DshToolDefinition | undefined {
    const ownerSession = agent?.id ?? scopedSessionId(this.ctx);
    const entries = this.definitionsByName.get(name);
    const liveAgent = ownerSession === undefined ? undefined : (this.rootContext.get("agents") as { get?(id: string): CompatibleAgent | undefined } | undefined)?.get?.(String(ownerSession));
    const scoped = liveAgent === undefined ? undefined : dshScopeChainOf(dshScopeOf(liveAgent.ctx)).map((scope) => entries?.find((entry) => entry.deferred === true && entry.scope === scope)).find((entry) => entry !== undefined);
    return entries?.find((entry) => entry.ownerSession === ownerSession)?.definition
      ?? scoped?.definition
      ?? entries?.find((entry) => entry.ownerSession === undefined)?.definition;
  }

  schemas(agent?: { readonly id?: string }): readonly { name: string; description: string; parameters: JsonSchema }[] {
    return this.tools.definitions((agent?.id ?? scopedSessionId(this.ctx)) as import("@seal-harness/core").SessionId | undefined).map((definition) => ({ name: definition.name, description: definition.description, parameters: definition.inputSchema }));
  }

  restrict(filter: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }, ownerSession?: import("@seal-harness/core").SessionId): () => void {
    ownerSession ??= scopedSessionId(this.ctx);
    if (ownerSession === undefined) throw new Error("tools.restrict() requires a scoped context; use tools.scope(sessionId).restrict()");
    if (this.tools.restrict === undefined) throw new Error("Seal Harness ToolService does not support restrictions");
    return this.ctx.effect(() => this.tools.restrict!(filter, { ownerSession }));
  }

  guard(guard: (execution: unknown) => string | undefined, ownerSession?: import("@seal-harness/core").SessionId): () => void {
    ownerSession ??= scopedSessionId(this.ctx);
    if (typeof guard !== "function") throw new TypeError("tools.guard() requires a function");
    if (this.tools.guard === undefined) throw new Error("Seal Harness ToolService does not support guards");
    return this.ctx.effect(() => this.tools.guard!((execution) => guard({ ...execution, arguments: execution.input }), ownerSession === undefined ? {} : { ownerSession }));
  }

  scope(session: string | { readonly id: string; readonly session?: { readonly cwd?: string } }): Readonly<Record<string, unknown>> {
    const ownerSession = (typeof session === "string" ? session : session.id) as import("@seal-harness/core").SessionId;
    const agent = typeof session === "string" ? { id: session } : session;
    return Object.freeze({
      register: (definition: unknown) => this.register(definition, ownerSession),
      get: (name: string) => this.get(name, agent),
      schemas: () => this.schemas(agent),
      restrict: (filter: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }) => this.restrict(filter, ownerSession),
      guard: (guard: (execution: unknown) => string | undefined) => this.guard(guard, ownerSession),
      presentAs: (mode: "native" | "ptc" | "both") => this.presentAs(mode),
    });
  }
}

function scopedSessionId(context: CordisContext): import("@seal-harness/core").SessionId | undefined {
  const scope = dshScopeOf(context) as { readonly id?: unknown } | undefined;
  return typeof scope?.id === "string" ? scope.id as import("@seal-harness/core").SessionId : undefined;
}

interface CompatibleAgent {
  readonly id: import("@seal-harness/core").SessionId;
  readonly session: CompatibleSession;
  readonly ctx: CordisContext;
  readonly status: "idle" | "running";
  readonly options?: { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: string; readonly maxTokens?: number };
  readonly inbox?: unknown;
  runMaintenance?<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T>;
  cancel?(cause: unknown, options?: { readonly keepInbox?: boolean }): void;
  whenIdle?(): Promise<void>;
  followup?(message: unknown): void;
  steer?(message: unknown): void;
  inject?(message: unknown): void;
  send?(message: unknown, target: "next-turn" | "next-step", wakeup: boolean): void;
}

interface CompatibleSessionEvent { readonly seq: number; readonly time: number; readonly type: string; readonly data: JsonValue; readonly ignorable?: true; readonly surfaceOp?: unknown; readonly sourceEventSeqs?: readonly number[] }

const REQUIRED_DSH_SESSION_EVENT_TYPES = new Set([
  "turn/start", "turn/end", "step/start", "step/end", "user/message",
  "assistant/chunk", "assistant/message", "tool/call", "tool/result",
  "request/header", "request/context", "session/end-seed", "agent/inbox/spliced",
  "tool/code-dispatch-start", "tool/code-dispatch",
]);
interface CompatibleSession {
  readonly id: import("@seal-harness/core").SessionId;
  readonly cwd?: string;
  readonly header: Readonly<Record<string, unknown>>;
  readonly inheritedEventCount: number;
  readonly firstLiveSeq: number;
  readonly seq: number;
  readonly surface: { readonly nodes: readonly number[]; readonly replaceGeneration: number };
  eventAt(seq: number): CompatibleSessionEvent | undefined;
  snapshotEvents(fromSeq?: number, toSeqExclusive?: number): readonly CompatibleSessionEvent[];
  ownEvents(): readonly CompatibleSessionEvent[];
  isOwnSeq(seq: number): boolean;
  requestHeader(): unknown;
  requestContext(): unknown;
  deriveMessages(): unknown[];
  deriveEventMessage(event: CompatibleSessionEvent): unknown | null;
  append(type: string, data: unknown, options?: { readonly surfaceOp?: unknown; readonly sourceEventSeqs?: readonly number[] }): CompatibleSessionEvent;
}

interface CompatibleAgentFactory {
  createAgent(ownerContext: CordisContext, options: unknown): Promise<{ readonly agent: CompatibleAgent; dispose(): Promise<void> }>;
  resume(ownerContext: CordisContext, options: unknown): Promise<{ readonly agent: CompatibleAgent; dispose(): Promise<void> }>;
}

class SealAgentRegistryBridge extends CordisService {
  private readonly agentBaseUrl: string | undefined;
  protected readonly agentsById = new Map<import("@seal-harness/core").SessionId, CompatibleAgent>();
  protected readonly preparingAgentsById = new Map<import("@seal-harness/core").SessionId, CompatibleAgent>();
  protected readonly scopesById = new Map<import("@seal-harness/core").SessionId, ReturnType<typeof createDshScope>>();
  protected readonly initiators = new AsyncLocalStorage<CompatibleAgent | undefined>();
  protected factory: CompatibleAgentFactory | undefined;
  protected readonly descriptors = new Map<import("@seal-harness/core").SessionId, { cwd?: string; model?: import("@seal-harness/core").ModelRef; reasoning?: "off" | "low" | "medium" | "high" | "max"; maxTokens?: number; turns?: number; seenRuns?: Set<string>; sessionMeta?: JsonObject; createdAt?: number; inheritedEventCount?: number; firstLiveSeq?: number }>();
  protected readonly injected = new Map<import("@seal-harness/core").SessionId, UserMessage[]>();
  protected readonly idleNextTurn = new Map<import("@seal-harness/core").SessionId, UserMessage[]>();
  protected readonly starting = new Map<import("@seal-harness/core").SessionId, Promise<import("@seal-harness/core").AgentExecution>>();
  protected readonly inboxWrites = new Map<import("@seal-harness/core").SessionId, Promise<void>>();
  protected readonly sessionLogs = new Map<import("@seal-harness/core").SessionId, CompatibleSessionEvent[]>();
  protected readonly sessionSeenSequences = new Map<import("@seal-harness/core").SessionId, Set<number>>();
  protected readonly sessionProjectionStates = new Map<import("@seal-harness/core").SessionId, SealDshProjectionState>();
  protected readonly pendingLocalSessionEvents = new Map<import("@seal-harness/core").SessionId, string[]>();
  protected readonly presetPreparations = new Map<import("@seal-harness/core").SessionId, Promise<void>>();
  protected readonly liveObserved = new Set<import("@seal-harness/core").SessionId>();

  constructor(context: CordisContext, readonly sealAgents?: AgentService, readonly sealSessions?: SessionStore, agentBaseUrl = context.baseUrl) {
    super(context, "agents");
    this.agentBaseUrl = agentBaseUrl;
  }

  get(id: string): CompatibleAgent | undefined { return this.agentsById.get(id as import("@seal-harness/core").SessionId); }
  list(): CompatibleAgent[] { return [...this.agentsById.values()]; }
  roots(): CompatibleAgent[] { return this.list().filter((agent) => typeof agent.session.header.parentSession !== "string" || !this.agentsById.has(agent.session.header.parentSession as import("@seal-harness/core").SessionId)); }
  currentInitiator(): CompatibleAgent | undefined { return this.initiators.getStore(); }
  requireInitiator(): CompatibleAgent { const agent = this.currentInitiator(); if (agent === undefined) throw new Error("no Agent initiator is active"); return agent; }
  withInitiator<T>(agent: CompatibleAgent, operation: () => T): T { return this.initiators.run(agent, operation); }
  withoutInitiator<T>(operation: () => T): T { return this.initiators.run(undefined, operation); }
  session(id: string): CompatibleSession | undefined { return this.agentsById.get(id as import("@seal-harness/core").SessionId)?.session; }
  sessions(): CompatibleSession[] { return [...this.agentsById.values()].map((agent) => agent.session); }
  scopeFor(id: string): unknown { const agent = this.agentsById.get(id as import("@seal-harness/core").SessionId); return agent === undefined ? undefined : dshScopeOf(agent.ctx); }
  retainLiveObservation(id: string): void { this.liveObserved.add(id as import("@seal-harness/core").SessionId); }
  async ensurePreset(id: import("@seal-harness/core").SessionId, preset: string): Promise<void> {
    const previous = this.presetPreparations.get(id);
    if (previous !== undefined) return previous;
    const preparing = (async () => {
      const presets = this.ctx.get("agentPresets") as { composedPreset(agentContext: CordisContext): string | undefined; select(agent: CompatibleAgent, id: string): Promise<unknown> } | undefined;
      if (presets === undefined) throw new Error("cannot prepare agent preset: DSH Agent Presets is not available");
      let agent = this.agentsById.get(id);
      if (agent === undefined) agent = (await this.resumeSealAgent(this.ctx, { resumeSessionId: id })).agent;
      const tools = this.ctx.get("tools") as SealToolRuntimeBridge | undefined;
      if (presets.composedPreset(agent.ctx) !== preset) await (tools?.captureComposition(agent, () => presets.select(agent!, preset)) ?? presets.select(agent, preset));
      tools?.bindAgent(agent);
      await this.drainInbox(id);
    })();
    this.presetPreparations.set(id, preparing);
    try { await preparing; }
    finally { if (this.presetPreparations.get(id) === preparing) this.presetPreparations.delete(id); }
  }
  async flushSession(id: string): Promise<boolean> {
    const sessionId = id as import("@seal-harness/core").SessionId;
    const agent = this.agentsById.get(sessionId); if (agent === undefined) return false;
    await this.drainInbox(sessionId);
    const listeners = await (agent.ctx.parallel as unknown as (name: string, session: CompatibleSession) => Promise<unknown[]>)("session/flush", agent.session);
    await this.drainInbox(sessionId);
    return this.sealSessions !== undefined || listeners.length > 0;
  }

  setFactory(factory: CompatibleAgentFactory): () => void {
    if (this.factory !== undefined) throw new Error("an agent factory is already registered");
    this.factory = factory;
    let active = true;
    return this.ctx.effect(() => () => {
      if (!active) return;
      active = false;
      if (this.factory === factory) this.factory = undefined;
    });
  }

  async create(options: unknown): Promise<{ readonly agent: CompatibleAgent; dispose(): Promise<void> }> {
    if (this.factory !== undefined) return this.factory.createAgent(this.ctx, options);
    return this.createSealAgent(this.ctx, options);
  }

  async resume(options: unknown): Promise<{ readonly agent: CompatibleAgent; dispose(): Promise<void> }> {
    if (this.factory !== undefined) return this.factory.resume(this.ctx, options);
    return this.resumeSealAgent(this.ctx, options);
  }

  private async createSealAgent(ownerContext: CordisContext, value: unknown): Promise<{ readonly agent: CompatibleAgent; dispose(): Promise<void> }> {
    if (this.sealSessions === undefined) throw new Error("cannot create agent: Seal SessionStore is not available");
    const options = objectValue(value, "agents.create options"); const id = stringValue(options.sessionId, "sessionId");
    const signal = options.signal instanceof AbortSignal ? options.signal : undefined; throwIfAborted(signal, id);
    if (await this.sealSessions.read(id as never) !== undefined) throw new Error(`session "${id}" already exists`);
    if (options.seed !== undefined && !Array.isArray(options.seed)) throw new TypeError("seed must be an array");
    const meta = options.meta === undefined ? {} : objectValue(options.meta, "meta");
    const cwd = typeof meta.cwd === "string" ? meta.cwd : process.cwd();
    if (!isAbsolute(cwd)) throw new TypeError("agent session cwd must be an absolute path");
    const sessionMeta = normalizeDshSessionMeta(meta, options.inheritedEventCount, options.seed ?? []);
    const agentPresets = this.ctx.get("agentPresets") as { readonly defaultId: string; mount(agentContext: CordisContext, preset?: string): Promise<{ id: string }>; composeFrom(agentContext: CordisContext, parentContext: CordisContext): string | undefined; composedPreset(agentContext: CordisContext): string | undefined } | undefined;
    const presetParent = agentPresets === undefined || typeof sessionMeta.parentSession !== "string" ? undefined : this.get(sessionMeta.parentSession);
    if (agentPresets !== undefined && typeof sessionMeta.agentPreset !== "string") sessionMeta.agentPreset = presetParent === undefined ? agentPresets.defaultId : agentPresets.composedPreset(presetParent.ctx) ?? agentPresets.defaultId;
    const inheritedEventCount = typeof sessionMeta.inheritedEventCount === "number" ? sessionMeta.inheritedEventCount : 0; delete sessionMeta.inheritedEventCount;
    const seedLog = [...normalizeDshSessionSeed(options.seed ?? [])];
    if (options.seed !== undefined && seedLog.at(-1)?.type !== "session/end-seed") seedLog.push(Object.freeze({ seq: seedLog.length, time: Date.now(), type: "session/end-seed", data: Object.freeze({}) }));
    this.sessionLogs.set(id as never, seedLog);
    this.pendingLocalSessionEvents.set(id as never, []);
    const previous = this.descriptors.get(id as never); this.installAgentOptions(id as never, cwd, options.agentOptions);
    Object.assign(this.descriptors.get(id as never)!, { sessionMeta, createdAt: Date.now(), inheritedEventCount, firstLiveSeq: (options.seed as readonly unknown[] | undefined)?.length ?? 0 });
    const prepared = this.prepareAdoption(id, { cwd });
    const release = ownerContext.effect(() => () => prepared.dispose(), `sealAgent.lifecycle(${id})`);
    try {
      // The official Session Controller supplies a setup callback that owns
      // preset composition. Only provide the compatibility fallback when a
      // caller creates directly without that transaction; mounting both paths
      // binds the same DSH scope key to a parent twice.
      if (agentPresets !== undefined && typeof options.setup !== "function") {
        const inherited = presetParent === undefined ? undefined : agentPresets.composeFrom(prepared.agent.ctx, presetParent.ctx);
        if (inherited === undefined) { const tools = this.ctx.get("tools") as SealToolRuntimeBridge | undefined; await (tools?.captureComposition(prepared.agent, () => agentPresets.mount(prepared.agent.ctx, sessionMeta.agentPreset as string)) ?? agentPresets.mount(prepared.agent.ctx, sessionMeta.agentPreset as string)); }
      }
      const setupResult = typeof options.setup === "function" ? await options.setup(prepared.agent.ctx) : undefined;
      (this.ctx.get("tools") as SealToolRuntimeBridge | undefined)?.bindAgent(prepared.agent);
      throwIfAborted(signal, id);
      if (setupResult !== undefined) {
        const commit = (setupResult as { commit?: unknown }).commit;
        if (typeof commit !== "function") throw new TypeError("Agent setup result must expose commit()");
        commit.call(setupResult);
      }
      const metadataValue = toJsonValue({ ...sessionMeta, ...(inheritedEventCount === 0 ? {} : { dshInheritedEventCount: inheritedEventCount }) });
      const initialEvents = importDshSeed(this.sessionLogs.get(id as never) ?? seedLog);
      const created = await this.sealSessions.create({ id: id as never, cwd, ...(typeof metadataValue === "object" && metadataValue !== null && !Array.isArray(metadataValue) && Object.keys(metadataValue).length > 0 ? { metadata: metadataValue as JsonObject } : {}), ...(initialEvents.length === 0 ? {} : { initialEvents }) });
      this.sessionSeenSequences.set(id as never, new Set(created.events.map((entry) => entry.sequence)));
      this.pendingLocalSessionEvents.set(id as never, []);
      this.observeSession(id as never, created.events);
      this.restoreInbox(id as never, created.events);
      throwIfAborted(signal, id); prepared.publish();
      (this.ctx.emit as unknown as (name: string, payload: unknown) => void)("agent/session-start", { agent: prepared.agent, source: "startup" });
      return { agent: prepared.agent, dispose: async () => { await Promise.resolve(release()); } };
    } catch (error) {
      await Promise.resolve(release()).catch(() => {});
      this.sessionLogs.delete(id as never); this.sessionSeenSequences.delete(id as never); this.sessionProjectionStates.delete(id as never); this.pendingLocalSessionEvents.delete(id as never);
      if (previous === undefined) this.descriptors.delete(id as never); else this.descriptors.set(id as never, previous);
      throw error;
    }
  }

  private async resumeSealAgent(ownerContext: CordisContext, value: unknown): Promise<{ readonly agent: CompatibleAgent; dispose(): Promise<void> }> {
    if (this.sealSessions === undefined) throw new Error("cannot resume agent: Seal SessionStore is not available");
    const options = objectValue(value, "agents.resume options"); const id = stringValue(options.resumeSessionId, "resumeSessionId");
    const signal = options.signal instanceof AbortSignal ? options.signal : undefined; throwIfAborted(signal, id);
    const session = await this.sealSessions.read(id as never); if (session === undefined) throw new Error(`session "${id}" was not found`);
    this.observeSession(id as never, session.events);
    this.descriptors.get(id as never)!.firstLiveSeq = this.sessionLogs.get(id as never)?.length ?? 0;
    await this.appendSeedBoundary(id as never);
    this.restoreInbox(id as never, session.events);
    const descriptor = this.descriptors.get(id as never); this.installAgentOptions(id as never, descriptor?.cwd ?? process.cwd(), options.agentOptions);
    const selectedPreset = this.sessionLogs.get(id as never)?.findLast((event) => event.type === "agent-preset/selected")?.data;
    if (descriptor?.sessionMeta !== undefined && selectedPreset !== null && typeof selectedPreset === "object" && typeof (selectedPreset as { agentPreset?: unknown }).agentPreset === "string") {
      descriptor.sessionMeta = { ...descriptor.sessionMeta, agentPreset: (selectedPreset as { agentPreset: string }).agentPreset };
    }
    const prepared = this.prepareAdoption(id, descriptor?.cwd === undefined ? {} : { cwd: descriptor.cwd });
    const release = ownerContext.effect(() => () => prepared.dispose(), `sealAgent.lifecycle(${id})`);
    try {
      const presets = this.ctx.get("agentPresets") as { mount(agentContext: CordisContext, preset?: string): Promise<{ id: string }> } | undefined;
      // As in createSealAgent(), an explicit factory setup owns composition.
      // The fallback is for direct compatibility callers that omit setup.
      if (presets !== undefined && typeof options.setup !== "function") {
        const tools = this.ctx.get("tools") as SealToolRuntimeBridge | undefined;
        await (tools?.captureComposition(prepared.agent, () => presets.mount(prepared.agent.ctx, typeof descriptor?.sessionMeta?.agentPreset === "string" ? descriptor.sessionMeta.agentPreset : undefined)) ?? presets.mount(prepared.agent.ctx, typeof descriptor?.sessionMeta?.agentPreset === "string" ? descriptor.sessionMeta.agentPreset : undefined));
      }
      const setupResult = typeof options.setup === "function" ? await options.setup(prepared.agent.ctx) : undefined;
      (this.ctx.get("tools") as SealToolRuntimeBridge | undefined)?.bindAgent(prepared.agent);
      throwIfAborted(signal, id);
      if (setupResult !== undefined) {
        const commit = (setupResult as { commit?: unknown }).commit;
        if (typeof commit !== "function") throw new TypeError("Agent setup result must expose commit()");
        commit.call(setupResult);
      }
      prepared.publish();
      (this.ctx.emit as unknown as (name: string, payload: unknown) => void)("agent/session-start", { agent: prepared.agent, source: "resume" });
      return { agent: prepared.agent, dispose: async () => { await Promise.resolve(release()); } };
    } catch (error) { await Promise.resolve(release()).catch(() => {}); throw error; }
  }

  private installAgentOptions(id: import("@seal-harness/core").SessionId, cwd: string, value: unknown): void {
    const descriptor = this.descriptors.get(id) ?? {}; descriptor.cwd = cwd;
    if (value !== undefined) {
      const options = objectValue(value, "agentOptions");
      if (typeof options.provider === "string" && typeof options.model === "string") descriptor.model = { provider: options.provider, model: options.model };
      if (typeof options.reasoningEffort === "string") descriptor.reasoning = sealReasoning(options.reasoningEffort);
      if (options.maxTokens !== undefined) descriptor.maxTokens = positiveInteger(options.maxTokens, "agentOptions.maxTokens");
    }
    if (descriptor.model === undefined) {
      const selection = (this.ctx.get("agentDefaultModel") as { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } | undefined)?.currentSelection();
      if (selection !== undefined) {
        descriptor.model = { provider: selection.provider, model: selection.model };
        if (selection.reasoningEffort !== undefined) descriptor.reasoning = sealReasoning(selection.reasoningEffort);
      }
    }
    this.descriptors.set(id, descriptor);
  }

  setStatus(id: import("@seal-harness/core").SessionId, status: "idle" | "running"): void {
    let agent = this.agentsById.get(id);
    if (agent === undefined) {
      agent = this.preparingAgentsById.get(id);
      if (agent !== undefined) {
        const preparingState = (agent as CompatibleAgent & { readonly __sealState?: { status: "idle" | "running" } }).__sealState;
        if (preparingState !== undefined) preparingState.status = status;
        return;
      }
      agent = this.adopt(id).agent;
      (this.ctx.emit as unknown as (name: string, payload: unknown) => void)("agent/session-start", { agent, source: "startup" });
    }
    const state = (agent as CompatibleAgent & { readonly __sealState?: { status: "idle" | "running" } }).__sealState;
    if (state === undefined || state.status === status) return;
    state.status = status;
    (this.ctx.emit as unknown as (name: string, payload: unknown) => void)("agent/status", { agent, status });
    if (status === "idle" && this.sealSessions !== undefined) void this.sealSessions.read(id).then((session) => { if (session !== undefined) this.restoreInbox(id, session.events); });
  }

  observeSession(id: import("@seal-harness/core").SessionId, events: readonly import("@seal-harness/core").StoredSessionEvent[]): void {
    const descriptor = this.descriptors.get(id) ?? {};
    for (const { event } of events) {
      if (event.type === "session.created") { descriptor.cwd = event.payload.cwd; const metadata: Record<string, JsonValue> = { ...(event.payload.metadata ?? {}) }; if (typeof metadata.dshInheritedEventCount === "number") { descriptor.inheritedEventCount = metadata.dshInheritedEventCount; delete metadata.dshInheritedEventCount; } descriptor.sessionMeta = metadata; descriptor.createdAt ??= Date.parse(events.find((entry) => entry.event === event)?.timestamp ?? "") || Date.now(); }
      else if (event.type === "run.started") { descriptor.model = event.payload.model; descriptor.seenRuns ??= new Set(); if (!descriptor.seenRuns.has(event.payload.runId)) { descriptor.seenRuns.add(event.payload.runId); descriptor.turns = (descriptor.turns ?? 0) + 1; } if (event.payload.reasoning === undefined) delete descriptor.reasoning; else descriptor.reasoning = event.payload.reasoning; if (event.payload.maxTokens === undefined) delete descriptor.maxTokens; else descriptor.maxTokens = event.payload.maxTokens; }
    }
    this.descriptors.set(id, descriptor);
    // A cold history follower yields its snapshot before asynchronously
    // promoting the Session. If Seal commits during that window, publish the
    // compatible Session first so the already-installed global session/event
    // listener observes the append; the later promotion resolves this same
    // resident Agent instead of creating a second one.
    const adoptAfterSync = this.liveObserved.has(id) && !this.agentsById.has(id) && events.some(({ event }) => event.type !== "session.created");
    this.syncSessionLog(id, events);
    if (adoptAfterSync) this.adopt(id);
  }

  private syncSessionLog(id: import("@seal-harness/core").SessionId, events: readonly import("@seal-harness/core").StoredSessionEvent[]): void {
    const log = this.sessionLogs.get(id) ?? []; if (!this.sessionLogs.has(id)) this.sessionLogs.set(id, log);
    const projection = this.sessionProjectionStates.get(id) ?? sealDshProjectionState(log);
    if (!this.sessionProjectionStates.has(id)) this.sessionProjectionStates.set(id, projection);
    const seen = this.sessionSeenSequences.get(id) ?? new Set<number>(); if (!this.sessionSeenSequences.has(id)) this.sessionSeenSequences.set(id, seen);
    for (const stored of events) {
      if (seen.has(stored.sequence)) continue; seen.add(stored.sequence);
      if (stored.event.type === "session.created") continue;
      const projected = sealSessionEventToDsh(stored.event, log.length, Date.parse(stored.timestamp) || Date.now(), projection);
      const key = dshSessionEventKey(projected.type, projected.data); const pending = this.pendingLocalSessionEvents.get(id);
      const pendingIndex = pending?.indexOf(key) ?? -1;
      if (pendingIndex >= 0) { pending!.splice(pendingIndex, 1); continue; }
      log.push(projected);
      const agent = this.agentsById.get(id);
      if (agent !== undefined) (agent.ctx.emit as unknown as (...args: unknown[]) => void)("session/event", agent.session, projected);
    }
  }

  notifyInbox(id: import("@seal-harness/core").SessionId, event: Extract<import("@seal-harness/core").RuntimeEvent, { type: "inbox_spliced" }>): void {
    const agent = this.agentsById.get(id); if (agent === undefined) return;
    const dispatch = agentEvents(this.ctx, agent as never);
    for (const message of event.removed ?? []) {
      if (event.outcome === "canceled") dispatch.emit("agent/inbox/discarded", { message } as never);
      else dispatch.emit("agent/inbox/claimed", { message, turn: Math.max(1, this.descriptors.get(id)?.turns ?? 0) } as never);
    }
    for (const message of event.inserted) dispatch.emit("agent/inbox/inserted", { message } as never);
  }

  notifyError(id: import("@seal-harness/core").SessionId, step: number, error: unknown): void {
    const agent = this.agentsById.get(id); if (agent === undefined) return;
    agentEvents(this.ctx, agent as never).emit("agent/error", { turn: Math.max(1, this.descriptors.get(id)?.turns ?? 0), step, error });
  }

  private restoreInbox(id: import("@seal-harness/core").SessionId, events: readonly import("@seal-harness/core").StoredSessionEvent[]): void {
    const restored = foldSessionInbox(events);
    this.idleNextTurn.set(id, structuredClone(restored.nextTurn) as UserMessage[]);
    this.injected.set(id, structuredClone(restored.nextStep) as UserMessage[]);
  }

  private persistInbox(id: import("@seal-harness/core").SessionId, payload: Extract<import("@seal-harness/core").SessionEvent, { type: "agent/inbox.spliced" }>["payload"]): void {
    this.persistSessionEvent(id, { type: "agent/inbox.spliced", payload });
  }

  private async appendSeedBoundary(id: import("@seal-harness/core").SessionId): Promise<void> {
    const log = this.sessionLogs.get(id); if (log === undefined || log.at(-1)?.type === "session/end-seed") return;
    const time = Date.now(); const data = Object.freeze({});
    const record = Object.freeze({ seq: log.length, time, type: "session/end-seed", data }) as CompatibleSessionEvent;
    log.push(record);
    const pending = this.pendingLocalSessionEvents.get(id) ?? []; if (!this.pendingLocalSessionEvents.has(id)) this.pendingLocalSessionEvents.set(id, pending);
    pending.push(dshSessionEventKey(record.type, data));
    this.persistSessionEvent(id, { type: "dsh.imported", payload: { type: record.type, data, time } });
    await this.drainInbox(id);
  }

  private persistSessionEvent(id: import("@seal-harness/core").SessionId, event: import("@seal-harness/core").SessionEvent): void {
    if (this.sealSessions === undefined) return;
    const previous = this.inboxWrites.get(id) ?? Promise.resolve();
    const write = previous.then(async () => {
      while (true) {
        const current = await this.sealSessions!.read(id); if (current === undefined) return;
        try {
          await this.sealSessions!.append({ id, expectedVersion: current.version, events: [event] });
          return;
        } catch (error) {
          if (!(error instanceof SessionConflictError)) throw error;
        }
      }
    });
    this.inboxWrites.set(id, write);
    void write.finally(() => { if (this.inboxWrites.get(id) === write) this.inboxWrites.delete(id); }).catch(() => {});
  }

  private async drainInbox(id: import("@seal-harness/core").SessionId): Promise<void> { await this.inboxWrites.get(id); }

  adopt(id: string, options: { readonly cwd?: string; readonly status?: string } = {}): { readonly agent: CompatibleAgent; dispose(): Promise<void> } {
    const prepared = this.prepareAdoption(id, options);
    prepared.publish();
    return { agent: prepared.agent, dispose: prepared.dispose };
  }

  private prepareAdoption(id: string, options: { readonly cwd?: string; readonly status?: string } = {}): { readonly agent: CompatibleAgent; publish(): void; dispose(): Promise<void> } {
    const sessionId = id as import("@seal-harness/core").SessionId;
    if (!id || this.agentsById.has(sessionId)) throw new Error(`agent "${id}" is already registered`);
    const identity = { id: sessionId };
    const scope = createDshScope(this.ctx.extend({ baseUrl: this.agentBaseUrl }), identity);
    const known = this.descriptors.get(sessionId);
    const cwd = options.cwd ?? known?.cwd;
    const headerMeta = known?.sessionMeta ?? {};
    const log = this.sessionLogs.get(sessionId) ?? []; if (!this.sessionLogs.has(sessionId)) this.sessionLogs.set(sessionId, log);
    const firstLiveSeq = known?.firstLiveSeq ?? log.length;
    let session!: CompatibleSession;
    session = Object.freeze({
      id: sessionId,
      header: Object.freeze({ version: 0, id: sessionId, createdAt: known?.createdAt ?? Date.now(), ...(cwd === undefined ? {} : { cwd }), ...headerMeta, isSeeded: headerMeta.isSeeded === true }),
      inheritedEventCount: known?.inheritedEventCount ?? 0,
      firstLiveSeq,
      ...(cwd === undefined ? {} : { cwd }),
      get seq() { return log.length; },
      get surface() { return foldCompatibleSessionSurface(log); },
      eventAt: (seq: number) => log[seq],
      snapshotEvents: (fromSeq = 0, toSeqExclusive = log.length) => Object.freeze(log.slice(fromSeq, toSeqExclusive)),
      ownEvents: () => Object.freeze(log.slice(known?.inheritedEventCount ?? 0)),
      isOwnSeq: (seq: number) => Number.isSafeInteger(seq) && seq >= (known?.inheritedEventCount ?? 0) && seq < log.length,
      requestHeader: () => {
        const data = [...log].reverse().find((event) => event.type === "request/header")?.data;
        return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Readonly<Record<string, JsonValue>>).header : undefined;
      },
      requestContext: () => [...log].reverse().find((event) => event.type === "request/context")?.data,
      deriveMessages: () => foldCompatibleSessionSurface(log).nodes.map((seq) => deriveCompatibleSessionMessage(log[seq]!)).filter((message) => message !== null),
      deriveEventMessage: (event: CompatibleSessionEvent) => deriveCompatibleSessionMessage(event),
      append: (type: string, data: unknown, appendOptions: { readonly surfaceOp?: unknown; readonly sourceEventSeqs?: readonly number[] } = {}) => {
        if (typeof type !== "string" || type.length === 0) throw new TypeError("session event type must be a non-empty string");
        const payload = objectValue(data, `session event ${type} data`); const normalized = toJsonValue(payload);
        if (normalized === undefined || normalized === null || Array.isArray(normalized) || typeof normalized !== "object") throw new TypeError("session event data must be a JSON object");
        const surfaceOp = normalizeCompatibleSurfaceOp(appendOptions.surfaceOp, `session event ${type}`);
        const sourceEventSeqs = normalizeCompatibleSourceEventSeqs(appendOptions.sourceEventSeqs, log.length, `session event ${type}`);
        const record = Object.freeze({ seq: log.length, time: Date.now(), type, data: normalized, ...(surfaceOp === undefined ? {} : { surfaceOp }), ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) }) as CompatibleSessionEvent;
        log.push(record);
        const pending = this.pendingLocalSessionEvents.get(sessionId) ?? []; if (!this.pendingLocalSessionEvents.has(sessionId)) this.pendingLocalSessionEvents.set(sessionId, pending); pending.push(dshSessionEventKey(type, normalized));
        this.persistSessionEvent(sessionId, importDshSeed([{ seq: record.seq, type, data: normalized, ...(record.surfaceOp === undefined ? {} : { surfaceOp: record.surfaceOp }), ...(record.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: record.sourceEventSeqs }) }])[0]!);
        (agent.ctx.emit as unknown as (...args: unknown[]) => void)("session/event", session, record);
        return record;
      },
    });
    const state: {
      status: "idle" | "running";
      maintenance: { controller: AbortController; done: Promise<void> } | undefined;
      wakeRequested: boolean;
    } = { status: options.status === "running" ? "running" : "idle", maintenance: undefined, wakeRequested: false };
    let agent!: CompatibleAgent;
    const activeExecution = () => this.sealAgents?.active?.(sessionId);
    const launch = (message: unknown): void => {
      if (this.sealAgents === undefined) throw new Error("Seal AgentService is not available");
      const descriptor = this.descriptors.get(sessionId);
      if (descriptor?.cwd === undefined || descriptor.model === undefined) throw new Error(`agent "${id}" has no recorded run configuration`);
      const normalized = normalizeAgentMessage(message);
      const queue = this.injected.get(sessionId) ?? []; const queuedContext = queue.splice(0);
      if (queuedContext.length > 0) this.persistInbox(sessionId, { target: "next-step", start: 0, removedCount: queuedContext.length, inserted: [] });
      const turn = (descriptor.turns ?? 0) + 1;
      // An idle Seal launch claims its prompt directly, without a Pi queue splice.
      agentEvents(this.ctx, agent as never).emit("agent/inbox/claimed", { message: normalized, turn } as never);
      const started = this.drainInbox(sessionId).then(() => this.sealAgents!.prompt({ sessionId, cwd: descriptor.cwd!, model: descriptor.model!, ...(descriptor.reasoning === undefined ? {} : { reasoning: descriptor.reasoning }), ...(descriptor.maxTokens === undefined ? {} : { maxTokens: descriptor.maxTokens }), prompt: normalized.content, ...(normalized.id === undefined ? {} : { promptMessageId: normalized.id }), ...(normalized.source === undefined ? {} : { promptSource: normalized.source }), ...(queuedContext.length === 0 ? {} : { injectedMessages: queuedContext }), runtimeHooks: { preStep: async ({ step, signal, messages }) => {
        const mutableMessages = messages.map((message) => ({ ...message, source: message.source ?? { kind: "user" as const } }));
        const decision = await agentEvents(this.ctx, agent as never).waterfall("agent/pre-step", { turn, step, signal, messages: mutableMessages } as never, () => Promise.resolve({ kind: "enter", messages: mutableMessages } as never));
        await this.drainInbox(sessionId);
        const value = objectValue(decision, "agent/pre-step result");
        if (value.kind === "reject") return { kind: "reject" };
        if (value.kind !== "enter") throw new TypeError("agent/pre-step result kind must be enter or reject");
        return { kind: "enter", messages: arrayValue(value.messages, "agent/pre-step messages").map(normalizeAgentMessage) };
      }, request: async ({ step, signal, config }) => {
        const proposal = await agentEvents(this.ctx, agent as never).waterfall("agent/request", { turn, step, signal }, () => Promise.resolve({ provider: config.model.provider, model: config.model.model, ...(config.reasoning === undefined ? {} : { reasoningEffort: config.reasoning }), ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }) } as never));
        const value = objectValue(proposal, "agent/request result");
        const provider = stringValue(value.provider, "agent/request provider"); const model = stringValue(value.model, "agent/request model");
        const reasoning = value.reasoningEffort === undefined ? undefined : sealReasoning(stringValue(value.reasoningEffort, "agent/request reasoningEffort"));
        const maxTokens = value.maxTokens === undefined ? undefined : positiveInteger(value.maxTokens, "agent/request maxTokens");
        await this.drainInbox(sessionId);
        return { model: { provider, model }, ...(reasoning === undefined ? {} : { reasoning }), ...(maxTokens === undefined ? {} : { maxTokens }) };
      }, requestError: async ({ step, signal, provider, failure }) => {
        let retryPolicy: unknown;
        const llm = this.ctx.get("llm") as (DshLlmRuntime & { providerRetryPolicy(name: string): unknown }) | undefined;
        if (llm !== undefined) {
          try { retryPolicy = llm.providerRetryPolicy(provider); } catch { retryPolicy = undefined; }
        }
        const action = await agentEvents(this.ctx, agent as never).waterfall("agent/request-error", { turn, step, provider, failure, retryPolicy, signal } as never, () => Promise.resolve(undefined));
        await this.drainInbox(sessionId);
        return action?.kind === "retry" ? "retry" : undefined;
      }, turnStopping: async ({ signal }) => {
        await agentEvents(this.ctx, agent as never).serial("agent/turn-stopping", { turn, signal });
        await this.drainInbox(sessionId);
      } } }));
      this.starting.set(sessionId, started);
      void started.then(
        () => { if (this.starting.get(sessionId) === started) this.starting.delete(sessionId); },
        () => { if (this.starting.get(sessionId) === started) this.starting.delete(sessionId); },
      );
    };
    const deliver = (message: unknown, placement: "followup" | "steer") => {
      const execution = activeExecution();
      if (execution !== undefined) { execution[placement === "followup" ? "followUp" : "steer"](normalizeAgentMessage(message)); return; }
      const starting = this.starting.get(sessionId);
      if (starting !== undefined) { void starting.then((created) => created[placement === "followup" ? "followUp" : "steer"](normalizeAgentMessage(message))); return; }
      if (state.maintenance !== undefined) {
        splice(placement === "followup" ? "next-turn" : "next-step", Number.MAX_SAFE_INTEGER, 0, [message]);
        state.wakeRequested = true;
        return;
      }
      launch(message);
    };
    const identified = (message: unknown): UserMessage => { const value = normalizeAgentMessage(message); return value.id === undefined ? { ...value, id: crypto.randomUUID() as never } : value; };
    const localQueue = (target: "next-turn" | "next-step") => {
      const store = target === "next-turn" ? this.idleNextTurn : this.injected;
      const entries = store.get(sessionId) ?? []; if (!store.has(sessionId)) store.set(sessionId, entries); return entries;
    };
    const pending = (target: "next-turn" | "next-step") => {
      const execution = activeExecution();
      return execution === undefined ? localQueue(target) : (execution.pendingMessages?.() ?? []).filter((entry) => entry.placement === (target === "next-turn" ? "queued" : "steering")).map((entry) => entry.message);
    };
    const splice = (target: "next-turn" | "next-step", start: number, deleteCount: number, inserted: readonly unknown[], outcome?: "canceled", claiming = false) => {
      const normalized = inserted.map(identified);
      const execution = activeExecution();
      if (execution === undefined) {
        if (!Number.isInteger(start) || !Number.isInteger(deleteCount) || deleteCount < 0) throw new TypeError("inbox splice requires integer start and non-negative deleteCount");
        const queue = localQueue(target); const offset = start < 0 ? Math.max(queue.length + start, 0) : Math.min(start, queue.length);
        const removedIds = new Set(queue.slice(offset, offset + deleteCount).map((message) => message.id));
        const retainedIds = new Set([...localQueue("next-turn"), ...localQueue("next-step")].filter((message) => !removedIds.has(message.id)).map((message) => message.id));
        for (const message of normalized) { if (retainedIds.has(message.id)) throw new Error(`pending message id is already queued: ${message.id}`); retainedIds.add(message.id); }
        const removed = queue.splice(start, deleteCount, ...normalized);
        const actualOutcome = outcome ?? (!claiming && removed.length > 0 ? "canceled" : undefined);
        this.persistInbox(sessionId, { target, start: offset, ...(removed.length === 0 ? {} : { removedCount: removed.length }), inserted: normalized, ...(actualOutcome === undefined ? {} : { outcome: actualOutcome }) });
        const dispatch = agentEvents(this.ctx, agent as never);
        for (const message of removed) {
          if (claiming) dispatch.emit("agent/inbox/claimed", { message, turn: (this.descriptors.get(sessionId)?.turns ?? 0) + 1 } as never);
          else dispatch.emit("agent/inbox/discarded", { message } as never);
        }
        for (const message of normalized) dispatch.emit("agent/inbox/inserted", { message } as never);
        return removed;
      }
      if (execution.splicePending === undefined) throw new Error("Seal Agent execution does not support inbox splice");
      return execution.splicePending(target === "next-turn" ? "queued" : "steering", start, deleteCount, normalized);
    };
    const inbox = Object.freeze({
      get nextTurn() { return pending("next-turn"); },
      get nextStep() { return pending("next-step"); },
      get hasPending() { return pending("next-turn").length > 0 || pending("next-step").length > 0; },
      clear: () => { const execution = activeExecution(); if (execution === undefined) { for (const target of ["next-step", "next-turn"] as const) { const count = localQueue(target).length; if (count > 0) splice(target, 0, count, [], "canceled"); } } else for (const entry of execution.pendingMessages?.() ?? []) execution.updatePendingMessage?.(entry.id, { kind: "remove" }); },
      remove: (messageIdentity: string) => { const execution = activeExecution(); if (execution !== undefined) return execution.updatePendingMessage?.(messageIdentity as never, { kind: "remove" }) === "updated"; for (const target of ["next-step", "next-turn"] as const) { const queue = localQueue(target); const index = queue.findIndex((message) => message.id === messageIdentity); if (index >= 0) { splice(target, index, 1, [], "canceled"); return true; } } return false; },
      replace: (messageIdentity: string, message: unknown) => { for (const target of ["next-step", "next-turn"] as const) { const queue = pending(target); const index = queue.findIndex((entry) => entry.id === messageIdentity); if (index >= 0) { splice(target, index, 1, [message]); return true; } } return false; },
      append: (target: "next-turn" | "next-step", message: unknown) => splice(target, Number.MAX_SAFE_INTEGER, 0, [message]),
      prepend: (target: "next-turn" | "next-step", message: unknown) => splice(target, 0, 0, [message]),
      splice,
      claim: (target: "next-turn" | "next-step") => {
        const step = splice("next-step", 0, Number.MAX_SAFE_INTEGER, [], undefined, true);
        return target === "next-step" ? step : [...step, ...splice("next-turn", 0, 1, [], undefined, true)];
      },
    });
    const controls = {
      inbox,
      cancel: (_cause: unknown, controlOptions?: { readonly keepInbox?: boolean }) => { if (controlOptions?.keepInbox !== true) inbox.clear(); state.wakeRequested = false; state.maintenance?.controller.abort(_cause); activeExecution()?.abort(_cause); },
      whenIdle: async () => { await state.maintenance?.done; const starting = this.starting.get(sessionId); const execution = starting === undefined ? activeExecution() : await starting; await execution?.result; await this.drainInbox(sessionId); },
      runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        if (state.status !== "idle" || state.maintenance !== undefined || activeExecution() !== undefined || this.starting.has(sessionId)) throw new Error(`agent "${id}" already has active work`);
        const controller = new AbortController();
        let resolveDone!: () => void;
        const done = new Promise<void>((resolve) => { resolveDone = resolve; });
        state.maintenance = { controller, done };
        return (async () => {
          try { return await job(controller.signal); }
          finally {
            state.maintenance = undefined;
            resolveDone();
            if (state.wakeRequested && inbox.hasPending) {
              state.wakeRequested = false;
              const target = inbox.nextTurn.length > 0 ? "next-turn" as const : "next-step" as const;
              const index = target === "next-turn" ? 0 : inbox.nextStep.length - 1;
              const waking = splice(target, index, 1, [])[0];
              if (waking !== undefined) launch(waking);
            }
          }
        })();
      },
      followup: (message: unknown) => deliver(message, "followup"),
      steer: (message: unknown) => deliver(message, "steer"),
      inject: (message: unknown) => {
        const normalized = identified(message);
        const execution = activeExecution();
        if (execution !== undefined) { execution.steer(normalized); return; }
        const starting = this.starting.get(sessionId);
        if (starting !== undefined) { void starting.then((created) => created.steer(normalized)); return; }
        splice("next-step", Number.MAX_SAFE_INTEGER, 0, [normalized]);
      },
      send: (message: unknown, target: "next-turn" | "next-step", wakeup: boolean) => {
        const execution = activeExecution();
        if (execution !== undefined) { if (wakeup) deliver(message, target === "next-turn" ? "followup" : "steer"); else splice(target, Number.MAX_SAFE_INTEGER, 0, [message]); return; }
        const normalized = identified(message); splice(target, Number.MAX_SAFE_INTEGER, 0, [normalized]);
        if (!wakeup) return;
        if (state.maintenance !== undefined) { state.wakeRequested = true; return; }
        const queue = localQueue(target); const waking = queue.shift(); if (waking !== undefined) launch(waking);
      },
    };
    const registry = this;
    const base = { id: sessionId, session, ...controls, get options() { const value = registry.descriptors.get(sessionId); return value?.model === undefined ? {} : { provider: value.model.provider, model: value.model.model, ...(value.reasoning === undefined ? {} : { reasoningEffort: value.reasoning }), ...(value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens }) }; }, get status() { return state.status; } } as Omit<CompatibleAgent, "ctx">;
    agent = Object.freeze({ ...base, get options() { return base.options; }, get status() { return state.status; }, ctx: scope.ctx.extend({ agent: base }), __sealState: state }) as CompatibleAgent;
    Object.defineProperty(agent.ctx, "agent", { value: agent, configurable: true });
    this.preparingAgentsById.set(sessionId, agent);
    let active = true; let published = false; let sessionAnnounced = false; let agentAnnounced = false;
    const publish = () => {
      if (!active) throw new Error(`agent "${id}" setup was disposed before publication`);
      if (published) return;
      if (this.agentsById.has(sessionId)) throw new Error(`agent "${id}" is already registered`);
      published = true; this.preparingAgentsById.delete(sessionId); this.agentsById.set(sessionId, agent); this.scopesById.set(sessionId, scope);
      sessionAnnounced = true;
      (agent.ctx.emit as unknown as (name: string, session: CompatibleSession) => void)("session/created", session);
      agentAnnounced = true;
      (agent.ctx.emit as unknown as (name: string, payload: unknown) => void)("agent/created", { agent });
    };
    const dispose = async () => { if (!active) return; active = false; await this.drainInbox(sessionId); if (this.preparingAgentsById.get(sessionId) === agent) this.preparingAgentsById.delete(sessionId); if (published && this.agentsById.get(sessionId) === agent) { this.agentsById.delete(sessionId); this.scopesById.delete(sessionId); this.sessionProjectionStates.delete(sessionId); if (agentAnnounced) (agent.ctx.emit as unknown as (name: string, payload: unknown) => void)("agent/disposed", { agent }); if (sessionAnnounced) (agent.ctx.emit as unknown as (name: string, session: CompatibleSession) => void)("session/disposed", session); } await scope.dispose(); };
    return { agent, publish, dispose };
  }
}

class CompatibleSessionStore extends DshSessionStore {
  constructor(context: CordisContext, private readonly agents?: SealAgentRegistryBridge) { super(context); }

  override get(id: any): any { return this.agents?.session(String(id)) ?? super.get(id); }

  override list(): any[] {
    const agentSessions = this.agents?.sessions() ?? [];
    const ids = new Set(agentSessions.map((session) => session.id));
    return [...agentSessions, ...super.list().filter((session) => !ids.has(session.id as never))];
  }

  override async flush(session: any): Promise<boolean> {
    const compatible = this.agents?.session(String(session?.id));
    if (compatible === session) {
      return this.agents!.flushSession(String(session.id));
    }
    return super.flush(session);
  }

  override fork(source: any, boundary?: any, childSessionId?: any): any {
    const compatible = typeof source === "string" ? this.agents?.session(source) : this.agents?.session(String(source?.id));
    if (compatible === undefined || (typeof source !== "string" && compatible !== source)) return super.fork(source, boundary, childSessionId);
    const end = boundary === undefined ? compatible.seq - 1 : Number(boundary);
    if (!Number.isSafeInteger(end) || end < -1 || end >= compatible.seq) throw new Error(`invalid fork boundary ${String(boundary)}`);
    const seed = end < 0 ? [] : compatible.snapshotEvents(0, end + 1).map((event) => {
      if (deriveCompatibleSessionMessage(event) === null || event.surfaceOp !== undefined) return event;
      return Object.freeze({ ...event, surfaceOp: "append" as const });
    });
    let turnOpen = false;
    for (const event of seed) {
      if (event.type === "turn/start") turnOpen = true;
      else if (event.type === "turn/end") turnOpen = false;
    }
    if (turnOpen) throw new SessionForkError(`cannot fork session "${compatible.id}" inside an open turn`, "OPEN_TURN");
    const header = compatible.header;
    return super.create(childSessionId, { seed: seed as never, inheritedEventCount: seed.length, meta: { ...(compatible.cwd === undefined ? {} : { cwd: compatible.cwd }), parentSession: compatible.id, isSeeded: true, ...(header.origin === undefined ? {} : { origin: header.origin }), ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }), ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }) } } as never);
  }
}

class SealSessionQuery extends DshSessionQuery {
  constructor(context: CordisContext, private readonly agents?: SealAgentRegistryBridge, private readonly searchEnabled = true) { super(context, {}); }

  override observeSession(sessionId: any, options: any = {}): any {
    if (options.projectionMode === "all") this.agents?.retainLiveObservation(String(sessionId));
    return super.observeSession(sessionId, options);
  }

  override async searchEvents(request: any, exec?: { readonly signal?: AbortSignal }): Promise<any> {
    if (!this.searchEnabled) throw Object.assign(new Error("session search is disabled"), { code: "SESSION_QUERY_SEARCH_DISABLED" });
    exec?.signal?.throwIfAborted(); const offset = sealSearchOffset(request.cursor); const limit = sealSearchLimit(request.limit);
    const documents = await this.filterEvents(request.sessionId, [...(request.filters ?? []), ...(String(request.query ?? "").trim().length === 0 ? [] : [{ kind: "text", text: String(request.query) }])]);
    const observation = await this.observeSession(request.sessionId, { ...(exec?.signal === undefined ? {} : { signal: exec.signal }), projectionMode: "none" });
    try {
      const page = documents.slice(offset, offset + limit).map((document) => ({ sessionId: document.sessionId, seq: document.seq, type: document.type, time: document.time, surface: document.surface, snippet: sealSearchSnippet(document.text, String(request.query ?? "")) }));
      return { session: structuredClone(observation.header), items: page, ...(offset + limit < documents.length ? { nextCursor: `seal:${offset + limit}` } : {}) };
    } finally { observation[Symbol.dispose](); }
  }

  override async searchSessions(request: any, exec?: { readonly signal?: AbortSignal }): Promise<any> {
    if (!this.searchEnabled) throw Object.assign(new Error("session search is disabled"), { code: "SESSION_QUERY_SEARCH_DISABLED" });
    exec?.signal?.throwIfAborted(); const offset = sealSearchOffset(request.cursor); const limit = sealSearchLimit(request.limit);
    const records = request.sessionFilters === undefined ? await this.listSessions(exec?.signal) : await this.filterSessions(request.sessionFilters, exec?.signal);
    const hits: any[] = [];
    for (const record of records) {
      exec?.signal?.throwIfAborted();
      const documents = await this.filterEvents(record.header.id, [...(request.eventFilters ?? []), ...(String(request.query ?? "").trim().length === 0 ? [] : [{ kind: "text", text: String(request.query) }])]);
      const document = documents.at(-1); if (document === undefined) continue;
      hits.push({ ...record, bestMatch: { sessionId: document.sessionId, seq: document.seq, type: document.type, time: document.time, surface: document.surface, snippet: sealSearchSnippet(document.text, String(request.query ?? "")) } });
    }
    const page = hits.slice(offset, offset + limit);
    return { items: page, ...(offset + limit < hits.length ? { nextCursor: `seal:${offset + limit}` } : {}) };
  }
}

function sealSearchLimit(value: unknown): number { if (value === undefined) return 20; if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError("session search limit must be a positive safe integer"); return value as number; }
function sealSearchOffset(value: unknown): number { if (value === undefined) return 0; const match = /^seal:(\d+)$/u.exec(String(value)); if (match === null) throw new TypeError("invalid session search cursor"); const offset = Number(match[1]); if (!Number.isSafeInteger(offset)) throw new TypeError("invalid session search cursor"); return offset; }
function sealSearchSnippet(textValue: string, query: string): string { const normalized = query.trim().toLocaleLowerCase(); const index = normalized.length === 0 ? 0 : textValue.toLocaleLowerCase().indexOf(normalized); const start = Math.max(0, (index < 0 ? 0 : index) - 80); return textValue.slice(start, start + 240); }

class SealSessionPersistenceBridge extends CordisService {
  readonly supportsRawArtifacts: boolean;
  private readonly writers = new Set<string>();
  private revision = 0;
  constructor(context: CordisContext, private readonly store: SessionStore, private readonly sessions: CompatibleSessionStore) { super(context, "sessionPersistence"); this.supportsRawArtifacts = store.readRaw !== undefined; }

  locate(meta: any): { readonly kind: string; readonly path: string } | undefined { return this.store.locate?.(stringValue(meta?.id, "session header id") as never); }
  async readRaw(idValue: unknown, signal?: AbortSignal): Promise<any> {
    if (this.store.readRaw === undefined) throw new Error("Seal SessionStore does not expose raw per-session artifacts");
    const artifact = await this.store.readRaw(stringValue(idValue, "session id") as never, signal);
    if (artifact === undefined) return undefined;
    const projected = projectSealSession(artifact.snapshot);
    return { filename: artifact.filename, content: artifact.content, meta: projected.meta, inheritedEventCount: projected.inheritedEventCount };
  }

  async create(header: any, options?: number | { readonly inheritedEventCount?: number; readonly signal?: AbortSignal }): Promise<SealPersistenceHandle> {
    const id = stringValue(header?.id, "session header id"); const signal = typeof options === "object" ? options.signal : undefined; signal?.throwIfAborted();
    const inheritedEventCount = typeof options === "number" ? options : options?.inheritedEventCount ?? 0;
    const metadata = dshHeaderMetadata(header, inheritedEventCount);
    await this.store.create({ id: id as never, cwd: typeof header.cwd === "string" ? header.cwd : process.cwd(), ...(Object.keys(metadata).length === 0 ? {} : { metadata }) });
    signal?.throwIfAborted(); this.claim(id);
    return new SealPersistenceHandle(this, id, header, "write", inheritedEventCount);
  }

  async open(idValue: unknown, access: "read" | "write", options?: { readonly signal?: AbortSignal }): Promise<SealPersistenceHandle> {
    const id = stringValue(idValue, "session id"); options?.signal?.throwIfAborted(); const snapshot = await this.require(id); options?.signal?.throwIfAborted();
    if (access === "write") this.claim(id);
    const projected = projectSealSession(snapshot);
    return new SealPersistenceHandle(this, id, projected.meta, access, projected.inheritedEventCount);
  }

  async append(idValue: unknown, events: readonly unknown[]): Promise<void> {
    const id = stringValue(idValue, "session id"); await this.appendEvents(id, events);
  }
  async ensureMaterialized(): Promise<void> {}
  async load(idValue: unknown): Promise<any> { return this.inspect(idValue); }
  async inspect(idValue: unknown, signal?: AbortSignal): Promise<any> { signal?.throwIfAborted(); return projectSealSession(await this.require(stringValue(idValue, "session id"))); }
  async readFrom(idValue: unknown, fromSeq: number, signal?: AbortSignal): Promise<any> { if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) throw new TypeError("fromSeq must be a non-negative safe integer"); const inspection = await this.inspect(idValue, signal); return { meta: inspection.meta, inheritedEventCount: inspection.inheritedEventCount, fromSeq, events: inspection.events.slice(fromSeq) }; }
  async list(signal?: AbortSignal): Promise<any[]> { signal?.throwIfAborted(); return Promise.all((await this.store.list()).map(async (snapshot) => (projectSealSession(snapshot)).meta)); }
  async listSnapshots(signal?: AbortSignal): Promise<any[]> { signal?.throwIfAborted(); return Promise.all((await this.store.list()).map(async (snapshot) => { const projected = projectSealSession(snapshot); return { header: projected.meta, revision: `seal:${snapshot.id}:${snapshot.version}:${this.revision}` }; })); }
  async prepare(idValue: unknown, signal?: AbortSignal): Promise<any> { const inspection = await this.inspect(idValue, signal); const session = this.sessions.prepare(inspection.meta.id, { seed: inspection.events, meta: inspection.meta, inheritedEventCount: inspection.inheritedEventCount, seedSource: "persistence" } as never); return DshSessionPreparation.create(session); }
  async borrowSession(idValue: unknown, signal?: AbortSignal): Promise<any> { const inspection = await this.inspect(idValue, signal); const preparedSession = this.sessions.prepare(inspection.meta.id, { seed: inspection.events, meta: inspection.meta, inheritedEventCount: inspection.inheritedEventCount, seedSource: "persistence" } as never); return { source: "prepared", inspection, revision: `seal:${String(idValue)}:${inspection.events.length}:${this.revision}`, preparedSession, [Symbol.dispose]() {} }; }

  async readEvents(id: string, offset = 0, length = Number.MAX_SAFE_INTEGER, signal?: AbortSignal): Promise<readonly CompatibleSessionEvent[]> { signal?.throwIfAborted(); const projected = projectSealSession(await this.require(id)); return projected.events.slice(offset, offset + length); }
  async appendEvents(id: string, values: readonly unknown[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); const current = await this.require(id); const projected = projectSealSession(current); const normalized = normalizeDshSessionSeed(values.map((value, index) => ({ ...objectValue(value, "persisted session event"), seq: projected.events.length + index })), projected.events.length);
    await this.store.append({ id: id as never, expectedVersion: current.version, events: importDshSeed(normalized) }); this.revision += 1;
  }
  release(id: string, access: "read" | "write"): void { if (access === "write") this.writers.delete(id); }
  private claim(id: string): void { if (this.writers.has(id)) throw new Error(`session "${id}" already has a write handle`); this.writers.add(id); }
  private async require(id: string): Promise<import("@seal-harness/core").SessionSnapshot> { const snapshot = await this.store.read(id as never); if (snapshot === undefined) throw new Error(`session "${id}" was not found`); return snapshot; }
}

class SealPersistenceHandle {
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly owner: SealSessionPersistenceBridge, readonly id: string, readonly header: any, readonly access: "read" | "write", readonly inheritedEventCount: number) {}
  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: { readonly signal?: AbortSignal }): Promise<readonly CompatibleSessionEvent[]> { this.assertOpen(); return this.owner.readEvents(this.id, offset, length, options?.signal); }
  async append(events: readonly unknown[], options?: { readonly signal?: AbortSignal }): Promise<void> { this.assertOpen(); if (this.access !== "write") throw new Error(`session "${this.id}" is read-only`); const operation = this.chain.then(() => this.owner.appendEvents(this.id, events, options?.signal)); this.chain = operation.catch(() => {}); return operation; }
  async flush(options?: { readonly signal?: AbortSignal }): Promise<void> { this.assertOpen(); options?.signal?.throwIfAborted(); await this.chain; options?.signal?.throwIfAborted(); }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; await this.chain; this.owner.release(this.id, this.access); }
  [Symbol.asyncDispose](): Promise<void> { return this.close(); }
  private assertOpen(): void { if (this.closed) throw new Error(`session "${this.id}" handle is closed`); }
}

function projectSealSession(snapshot: import("@seal-harness/core").SessionSnapshot): { readonly meta: Readonly<Record<string, unknown>>; readonly inheritedEventCount: number; readonly events: readonly CompatibleSessionEvent[] } {
  const created = snapshot.events.find((entry) => entry.event.type === "session.created");
  if (created?.event.type !== "session.created") throw new Error(`session "${snapshot.id}" has no creation event`);
  const metadata = created.event.payload.metadata ?? {}; const inheritedEventCount = typeof metadata.dshInheritedEventCount === "number" ? metadata.dshInheritedEventCount : 0;
  const clean = { ...metadata }; delete clean.dshInheritedEventCount; const persistedCreatedAt = typeof clean.dshCreatedAt === "number" ? clean.dshCreatedAt : undefined; delete clean.dshCreatedAt;
  const meta = Object.freeze({ version: 0, id: snapshot.id, createdAt: persistedCreatedAt ?? (Date.parse(created.timestamp) || 0), cwd: created.event.payload.cwd, ...clean, isSeeded: clean.isSeeded === true });
  const projection = sealDshProjectionState();
  const events = snapshot.events.filter((entry) => entry.event.type !== "session.created").map((entry, index) => sealSessionEventToDsh(entry.event, index, Date.parse(entry.timestamp) || 0, projection));
  return { meta, inheritedEventCount, events: Object.freeze(events) };
}

function dshHeaderMetadata(header: Readonly<Record<string, unknown>>, inheritedEventCount: number): JsonObject {
  const metadata: Record<string, JsonValue> = { ...(typeof header.createdAt === "number" ? { dshCreatedAt: header.createdAt } : {}) };
  for (const key of ["parentSession", "isSeeded", "origin", "delegationDepth", "agentPreset"] as const) { const raw = header[key]; if (raw === undefined) continue; const value = toJsonValue(raw); if (value !== undefined) metadata[key] = value; }
  if (inheritedEventCount > 0) metadata.dshInheritedEventCount = inheritedEventCount;
  return metadata;
}

function adaptDshTool(
  cordisContext: CordisContext,
  definition: DshToolDefinition,
  options: ToolBridgeOptions,
): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.parameters,
    ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
    modelVisible: true,
    classify(input) {
      return {
        kind: "tool",
        toolName: definition.name,
        risk: options.risks[definition.name] ?? options.defaultRisk,
        summary: `Run DSH tool ${definition.name}`,
      };
    },
    async execute(input, executionContext) {
      const agent = (cordisContext.get("agents") as any)?.get?.(String(executionContext.sessionId)) as CompatibleAgent | undefined;
      const dshExecution = {
        callId: String(executionContext.callId), rootCallId: String(executionContext.callId), name: definition.name,
        arguments: input, agent, signal: executionContext.signal, token: Symbol(`seal-dsh-tool:${executionContext.callId}`),
      } as any;
      const execute = () => executeDshTool(definition, input, { ...executionContext, signal: dshExecution.signal }, agent);
      const rawResult: any = agent === undefined
        ? await execute()
        : await (agentEvents(cordisContext, agent as never) as any).waterfall("tools/execute", dshExecution, execute);
      const result: ToolResult = {
        content: normalizeContent(rawResult.content),
        ...(rawResult.isError === true ? { isError: true } : {}),
        ...(rawResult.details === undefined ? (Object.hasOwn(rawResult, "value") ? { details: toJsonValue({ value: rawResult.value }) } : {}) : { details: rawResult.details }),
        ...(rawResult.additionalContexts === undefined ? {} : { additionalContexts: rawResult.additionalContexts.map(normalizeDeferredContext) }),
        ...(rawResult.concludesTurn === true ? { concludesTurn: true } : {}),
      };
      if (agent === undefined) return result;
      const dshResult = result.isError === true
        ? { isError: true, error: rawResult.error ?? { message: result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") }, content: result.content }
        : { isError: false, value: (result.details as any)?.value ?? null, content: result.content };
      const decision: any = await (agentEvents(cordisContext, agent as never) as any).waterfall("tools/post-execute", dshExecution, dshResult as any, () => Promise.resolve({ kind: "accept" } as any));
      const additionalContexts = [...result.additionalContexts ?? [], ...(decision.additionalContexts ?? []).map(normalizeDeferredContext)];
      const finalResult: ToolResult = decision.kind === "block"
        ? { content: normalizeContent(decision.feedback), isError: true, ...(additionalContexts.length === 0 ? {} : { additionalContexts }) }
        : { ...result, ...(decision.content === undefined ? {} : { content: normalizeContent(decision.content) }), ...(additionalContexts.length === 0 ? {} : { additionalContexts }) };
      (cordisContext.emit as any)("tools/result", dshExecution, finalResult.isError
        ? { isError: true, error: { message: finalResult.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") }, content: finalResult.content }
        : { isError: false, value: (finalResult.details as any)?.value ?? null, content: finalResult.content });
      return finalResult;
    },
  };
}

function createRunCodeBridge(context: CordisContext, tools: ToolService, options: ToolBridgeOptions): ToolDefinition {
  return {
    name: "run_code",
    description: "Execute a TypeScript program against the available tools. Pass code as the body of an async function; top-level await and return are supported.",
    inputSchema: { type: "object", properties: { code: { type: "string" }, description: { type: "string" } }, required: ["code", "description"], additionalProperties: false },
    classify() { return { kind: "tool", toolName: "run_code", risk: "external", summary: "Execute a tool orchestration program" }; },
    async execute(input, execution) {
      const runtime = context.get("codeRuntime") as { run(request: unknown): Promise<{ value?: JsonValue; logs: string[]; error?: { kind: string; message: string } }> } | undefined;
      if (runtime === undefined) throw new Error("run_code requires ctx.codeRuntime");
      const definitions = tools.definitions(execution.sessionId, { includeHidden: true }).filter((definition) => definition.name !== "run_code");
      const functions: Record<string, (args: unknown) => Promise<JsonValue>> = Object.create(null) as Record<string, (args: unknown) => Promise<JsonValue>>;
      const attachments: ContentBlock[] = []; let active = 0; let submitted = 0; const waiters: Array<() => void> = [];
      const enter = async () => { if (active >= options.maxParallelCodeCalls) await new Promise<void>((resolve) => waiters.push(resolve)); active += 1; };
      const leave = () => { active -= 1; waiters.shift()?.(); };
      for (const definition of definitions) Object.defineProperty(functions, definition.name, { enumerable: true, value: async (args: unknown) => {
        const sequence = submitted++; const subCallId = toolCallId(`${execution.callId}:code:${sequence}`);
        const normalizedArguments = toJsonValue(args);
        await enter();
        try {
          if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error(`${definition.name} arguments must be an object`);
          await execution.reportDispatch?.({ type: "start", rootCallId: execution.callId, parentCallId: execution.callId, subCallId, name: definition.name, arguments: normalizedArguments });
          let result: ToolResult;
          try {
            result = await tools.execute({ callId: subCallId, sessionId: execution.sessionId, cwd: execution.cwd, name: definition.name, input: args as JsonObject, signal: execution.signal, ...(execution.reportDispatch === undefined ? {} : { reportDispatch: execution.reportDispatch }) });
          } catch (error) {
            result = { content: [text(errorMessage(error))], isError: true };
          }
          await execution.reportDispatch?.({ type: "settle", rootCallId: execution.callId, parentCallId: execution.callId, subCallId, name: definition.name, arguments: normalizedArguments, result });
          if (result.isError) throw new Error(result.content.map((block) => block.type === "text" ? block.text : `[${block.type}]`).join("\n"));
          attachments.push(...result.content.filter((block) => block.type !== "text"));
          const details = result.details;
          if (details && typeof details === "object" && !Array.isArray(details) && "value" in details) return (details as { value: JsonValue }).value;
          return result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        } finally { leave(); }
      } });
      const result = await runtime.run({ program: String(input.code), bindings: [{ global: "tools", functions, errorClass: { name: "ToolCallError", memberNameProperty: "toolName" } }], signal: execution.signal });
      if (result.error !== undefined) throw new Error(`code run failed (${result.error.kind}): ${result.error.message}${result.logs.length ? `\nCaptured output:\n${result.logs.join("\n")}` : ""}`);
      const summary = [...result.logs.map((line) => text(line)), ...(result.value === undefined ? [] : [text(JSON.stringify(result.value))]), ...attachments];
      return { content: summary.length === 0 ? [text("Code completed without output")] : summary, details: { value: result.value ?? null, logs: result.logs } };
    },
  };
}

async function executeDshTool(
  definition: DshToolDefinition,
  input: JsonObject,
  context: ToolExecutionContext,
  agent?: CompatibleAgent,
): Promise<ToolResult> {
  const deferredContexts: unknown[] = [];
  let concludesTurn = false;
  const execution: DshToolRunContext = Object.freeze({
    callId: context.callId,
    rootCallId: context.callId,
    name: definition.name,
    arguments: input,
    signal: context.signal,
    token: Symbol(`dsh-tool:${definition.name}:${context.callId}`),
    ...(agent === undefined ? {} : { agent }),
    deferContext(message: unknown) {
      deferredContexts.push(message);
    },
    concludeTurn() {
      concludesTurn = true;
    },
  });

  try {
    const value = await definition.execute(input, execution);
    let content = normalizeContent(definition.output.render(input, value));
    const result: DshToolExecutionResult = {
      isError: false,
      value,
      content,
      ...(definition.output.presentationMeta === undefined
        ? {}
        : { meta: toJsonValue(definition.output.presentationMeta(input, value)) }),
      ...(deferredContexts.length === 0 ? {} : { additionalContexts: deferredContexts }),
      ...(concludesTurn ? { concludesTurn: true as const } : {}),
    };
    const replacement = definition.finalizeContent?.(execution, result);
    if (replacement !== undefined) content = normalizeContent(replacement);
    return {
      content,
      ...(deferredContexts.length === 0 ? {} : { additionalContexts: deferredContexts.map(normalizeDeferredContext) }),
      ...(concludesTurn ? { concludesTurn: true as const } : {}),
      details: toJsonValue({
        value,
        dsh: { deferredContexts, concludesTurn },
      }),
    };
  } catch (error) {
    let content: ContentBlock[] = [text(errorMessage(error))];
    const result: DshToolExecutionResult = {
      isError: true,
      error: {
        message: errorMessage(error),
        info: { name: error instanceof Error ? error.name : "Error" },
      },
      content,
      ...(deferredContexts.length === 0 ? {} : { additionalContexts: deferredContexts }),
    };
    const replacement = definition.finalizeContent?.(execution, result);
    if (replacement !== undefined) content = normalizeContent(replacement);
    return {
      content,
      isError: true,
      ...(deferredContexts.length === 0 ? {} : { additionalContexts: deferredContexts.map(normalizeDeferredContext) }),
      details: toJsonValue({
        error: result.error,
        dsh: { deferredContexts, concludesTurn: false },
      }),
    };
  }
}

function normalizeDeferredContext(value: unknown): UserMessage {
  if (typeof value !== "object" || value === null || (value as { role?: unknown }).role !== "user") {
    throw new TypeError("DSH deferContext() requires a user message");
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new TypeError("DSH deferred user message requires content");
  const id = (value as { id?: unknown }).id;
  const rawSource = (value as { source?: unknown }).source;
  const source = rawSource === undefined ? undefined : toJsonValue(rawSource);
  if (source !== undefined && (source === null || typeof source !== "object" || Array.isArray(source))) throw new TypeError("DSH user message source must be an object");
  return { role: "user", content: normalizeContent(content), ...(typeof id === "string" ? { id: id as never } : {}), ...(source === undefined ? {} : { source: source as JsonObject }) };
}

function normalizeAgentMessage(value: unknown): UserMessage {
  return normalizeDeferredContext(value);
}

function assertDshTool(value: unknown): DshToolDefinition {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("DSH tools.register() requires a tool definition object");
  }
  const candidate = value as Partial<DshToolDefinition>;
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    throw new TypeError("DSH tool name must be a non-empty string");
  }
  if (typeof candidate.description !== "string") {
    throw new TypeError(`DSH tool ${candidate.name} is missing description`);
  }
  if (typeof candidate.parameters !== "object" || candidate.parameters === null) {
    throw new TypeError(`DSH tool ${candidate.name} is missing parameters JSON Schema`);
  }
  if (
    typeof candidate.output !== "object"
    || candidate.output === null
    || typeof candidate.output.render !== "function"
  ) {
    throw new TypeError(`DSH tool ${candidate.name} is missing output.render()`);
  }
  if (typeof candidate.execute !== "function") {
    throw new TypeError(`DSH tool ${candidate.name} is missing execute()`);
  }
  return candidate as DshToolDefinition;
}

function normalizePlugin(source: DshPluginSource): DshPlugin {
  if (isCordisPlugin(source)) return source;
  if (typeof source === "object" && source !== null && isCordisPlugin(source.default)) {
    return source.default;
  }
  throw new TypeError("Invalid DSH plugin: expected a function, class, { apply } object, or module namespace");
}

function isCordisPlugin(value: unknown): value is DshPlugin {
  return typeof value === "function"
    || (typeof value === "object" && value !== null && typeof (value as { apply?: unknown }).apply === "function");
}

function normalizeContent(values: readonly unknown[]): ContentBlock[] {
  return values.map((value) => {
    if (typeof value !== "object" || value === null) return text(String(value));
    const block = value as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return text(block.text);
    }
    if (
      block.type === "image"
      && typeof block.data === "string"
      && typeof block.mimeType === "string"
    ) {
      return { type: "image", data: block.data, mimeType: block.mimeType };
    }
    const image = normalizeDshImageBlock(block); if (image !== undefined) return image;
    return text(`[DSH content ${String(block.type ?? "unknown")}] ${safeJson(value)}`);
  });
}

function normalizeDshImageBlock(block: Record<string, unknown>): import("@seal-harness/core").AttachmentBlock | undefined {
  if (block.type !== "image" || typeof block.attachment !== "object" || block.attachment === null || Array.isArray(block.attachment)) return undefined;
  const attachment = block.attachment as Record<string, unknown>; if (typeof attachment.attachmentId !== "string" || typeof attachment.mediaType !== "string") return undefined;
  return { type: "attachment", id: attachment.attachmentId, mimeType: attachment.mediaType, ...(typeof attachment.name === "string" ? { name: attachment.name } : {}), providerData: { dshAttachment: toJsonValue(block) as JsonObject } };
}

function dshSessionEventKey(type: string, data: JsonValue): string { return `${type}\u0000${safeJson(data)}`; }

function normalizeDshSessionSeed(values: readonly unknown[], baseSeq = 0): CompatibleSessionEvent[] {
  return values.map((value, index) => {
    const event = objectValue(value, `DSH seed event ${index}`);
    const seq = baseSeq + index;
    if (event.seq !== seq) throw new TypeError(`DSH seed event seq must be contiguous; expected ${seq}`);
    if (!Number.isSafeInteger(event.time) || (event.time as number) < 0) throw new TypeError("DSH seed event time must be a non-negative safe integer");
    const type = stringValue(event.type, "DSH seed event type"); const raw = objectValue(event.data, `DSH seed event ${type} data`); const data = toJsonValue(raw);
    if (data === undefined || data === null || Array.isArray(data) || typeof data !== "object") throw new TypeError("DSH seed event data must be a JSON object");
    const surfaceOp = normalizeCompatibleSurfaceOp(event.surfaceOp, `DSH seed event ${index}`);
    const sourceEventSeqs = normalizeCompatibleSourceEventSeqs(event.sourceEventSeqs, seq, `DSH seed event ${index}`);
    return Object.freeze({ seq, time: event.time as number, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }), ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) });
  });
}

function normalizeCompatibleSurfaceOp(value: unknown, label: string): "append" | { readonly op: "replace"; readonly start: number; readonly end: number } | undefined {
  if (value === undefined) return undefined;
  if (value === "append") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} surfaceOp is invalid`);
  const operation = value as Readonly<Record<string, unknown>>;
  if (Object.keys(operation).length !== 3 || operation.op !== "replace" || !Number.isSafeInteger(operation.start) || !Number.isSafeInteger(operation.end) || (operation.start as number) < 0 || (operation.end as number) < (operation.start as number)) throw new TypeError(`${label} replace surfaceOp is invalid`);
  return Object.freeze({ op: "replace", start: operation.start as number, end: operation.end as number });
}

function normalizeCompatibleSourceEventSeqs(value: unknown, before: number, label: string): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} sourceEventSeqs must be a non-empty array`);
  const seen = new Set<number>();
  const normalized = value.map((entry) => {
    if (!Number.isSafeInteger(entry) || (entry as number) < 0 || (entry as number) >= before || seen.has(entry as number)) throw new TypeError(`${label} sourceEventSeqs must contain unique earlier event sequences`);
    seen.add(entry as number); return entry as number;
  });
  return Object.freeze(normalized);
}

function deriveCompatibleSessionMessage(event: CompatibleSessionEvent): unknown | null {
  if (event.type === "user/message") return event.data;
  if (event.type === "assistant/message" || event.type === "tool/result") {
    const data = event.data;
    return typeof data === "object" && data !== null && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, "message") ? (data as Readonly<Record<string, JsonValue>>).message : null;
  }
  return null;
}

function foldCompatibleSessionSurface(events: readonly CompatibleSessionEvent[]): { readonly nodes: readonly number[]; readonly replaceGeneration: number } {
  const nodes: number[] = [];
  let replaceGeneration = 0;
  for (const event of events) {
    if (deriveCompatibleSessionMessage(event) === null) continue;
    const operation = event.surfaceOp;
    if (operation === undefined || operation === "append" || (typeof operation === "object" && operation !== null && (operation as { readonly op?: unknown }).op === "append")) {
      nodes.push(event.seq);
      continue;
    }
    if (typeof operation !== "object" || operation === null || (operation as { readonly op?: unknown }).op !== "replace") continue;
    const { start, end } = operation as { readonly start?: unknown; readonly end?: unknown };
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    const first = nodes.indexOf(start as number);
    const last = nodes.indexOf(end as number);
    if (first < 0 || last < first) continue;
    nodes.splice(first, last - first + 1, event.seq);
    replaceGeneration += 1;
  }
  return Object.freeze({ nodes: Object.freeze(nodes), replaceGeneration });
}

interface SealDshProjectionState {
  readonly turns: Map<string, number>;
  readonly toolArguments: Map<string, string>;
  turn: number;
  step: number;
  advanceStep: boolean;
  turnOpen: boolean;
  model?: { readonly provider: string; readonly model: string };
}

function sealDshProjectionState(events: readonly CompatibleSessionEvent[] = []): SealDshProjectionState {
  const state: SealDshProjectionState = { turns: new Map(), toolArguments: new Map(), turn: 0, step: 0, advanceStep: false, turnOpen: false };
  for (const event of events) updateSealDshProjectionFromDsh(state, event.type, event.data);
  return state;
}

function updateSealDshProjectionFromDsh(state: SealDshProjectionState, type: string, data: JsonValue): void {
  const record = jsonRecord(data);
  if (typeof record?.turn === "number") state.turn = record.turn;
  if (type === "turn/start") { state.step = 0; state.advanceStep = false; state.turnOpen = true; }
  else if (type === "turn/end") state.turnOpen = false;
  else if (type === "step/start" && typeof record?.step === "number") { state.step = record.step; state.advanceStep = false; }
  else if (type === "tool/result") state.advanceStep = true;
  else if (type === "assistant/message") state.advanceStep = false;
  if (type === "tool/call" && typeof record?.callId === "string" && typeof record.arguments === "string") state.toolArguments.set(record.callId, record.arguments);
}

function sealProjectionTurn(state: SealDshProjectionState, id: string | undefined): number {
  if (id === undefined) return state.turn;
  const known = state.turns.get(id);
  if (known !== undefined) return known;
  const turn = state.turn + 1;
  state.turns.set(id, turn); state.turn = turn;
  return turn;
}

function sealSessionEventToDsh(event: import("@seal-harness/core").SessionEvent, seq: number, time: number, projection = sealDshProjectionState()): CompatibleSessionEvent {
  let type: string = event.type; let data: JsonValue = toJsonValue(event.payload) ?? {};
  if (event.type === "dsh.imported") { type = event.payload.type; data = event.payload.data; time = event.payload.time ?? time; updateSealDshProjectionFromDsh(projection, type, data); }
  else if (event.type === "agent/inbox.spliced") type = "agent/inbox/spliced";
  else if (event.type === "request.header") type = "request/header";
  else if (event.type === "request.context") type = "request/context";
  else if (event.type === "run.started") {
    projection.model = event.payload.model;
  }
  else if (event.type === "assistant.chunk") {
    const turn = sealProjectionTurn(projection, event.payload.turnId);
    projection.step = event.payload.step;
    type = "assistant/chunk"; data = { turn, step: event.payload.step, chunk: event.payload.chunk };
  }
  else if (event.type === "turn.started") {
    const turn = projection.turn + 1;
    projection.turns.set(event.payload.turnId, turn); projection.turn = turn; projection.step = 0; projection.advanceStep = false; projection.turnOpen = true;
    type = "turn/start"; data = { turn };
  } else if (event.type === "turn.completed") {
    const turn = sealProjectionTurn(projection, event.payload.turnId);
    const reason: JsonValue = event.payload.outcome === "interrupted"
      ? { kind: "interrupted" }
      : event.payload.stopReason === "length"
        ? { kind: "max-tokens" }
        : event.payload.stopReason === "aborted"
          ? { kind: "aborted", reason: { kind: "legacy" } }
          : event.payload.stopReason === "error"
            ? { kind: "error", error: { message: "Seal model request failed", code: "UNKNOWN" } }
            : { kind: "completed" };
    type = "turn/end"; data = { turn, reason }; projection.turnOpen = false;
  } else if (event.type === "step.started" || event.type === "step.completed") {
    const turn = sealProjectionTurn(projection, event.payload.turnId);
    projection.turn = turn; projection.step = event.payload.step; projection.advanceStep = false;
    type = event.type === "step.started" ? "step/start" : "step/end";
    data = { turn, step: event.payload.step };
  } else if (event.type === "tool.started") {
    const turn = sealProjectionTurn(projection, event.payload.turnId);
    type = "tool/call";
    data = { turn, step: projection.step, callId: event.payload.callId, name: event.payload.name, arguments: projection.toolArguments.get(event.payload.callId) ?? JSON.stringify(event.payload.input) };
  } else if (event.type === "run.completed" && projection.turnOpen && event.payload.outcome !== "completed") {
    type = "turn/end";
    data = event.payload.outcome === "aborted"
      ? { turn: projection.turn, reason: { kind: "aborted", reason: { kind: "legacy" } } }
      : { turn: projection.turn, reason: { kind: "error", error: { message: event.payload.error ?? "Seal agent run failed", code: "UNKNOWN" } } };
    projection.turnOpen = false;
  }
  else if (event.type === "message.appended") {
    const message = event.payload.message;
    const content = message.content.map(sealContentBlockToDsh);
    if (message.role === "user") {
      // Seal durably records the input before running admission hooks. A numbered
      // compatibility goal round is only admitted by the later pre-step record.
      const pendingGoal = event.payload.runId === undefined && message.source?.kind === "goal" && typeof message.source.round === "number" && message.source.round > 0;
      type = pendingGoal ? "seal/input-pending" : "user/message";
      data = { id: event.payload.messageId, role: "user", content, source: message.source ?? { kind: "user" } };
    } else if (message.role === "assistant") {
      const turn = sealProjectionTurn(projection, event.payload.turnId);
      if (projection.advanceStep) projection.step += 1;
      projection.advanceStep = false;
      for (const block of message.content) if (block.type === "tool_call") projection.toolArguments.set(block.id, typeof block.providerData?.dshArguments === "string" ? block.providerData.dshArguments : JSON.stringify(block.arguments));
      type = "assistant/message";
      const imported = jsonRecord(message.providerData?.dsh);
      const importedSource = jsonRecord(imported?.source);
      const source = importedSource ?? { kind: "model", provider: typeof message.providerData?.provider === "string" ? message.providerData.provider : projection.model?.provider ?? "seal", model: typeof message.providerData?.model === "string" ? message.providerData.model : projection.model?.model ?? "unknown" };
      data = {
        turn, step: projection.step,
        message: { id: event.payload.messageId, role: "assistant", content, source: message.replayState === undefined ? source : { ...source, replayState: toJsonValue(message.replayState) } },
        ...(imported?.usage === undefined ? {} : { usage: imported.usage }),
        ...(imported?.interrupted === true ? { interrupted: true } : {}),
      };
    } else {
      const turn = sealProjectionTurn(projection, event.payload.turnId);
      type = "tool/result";
      const imported = jsonRecord(message.providerData?.dsh);
      const source = jsonRecord(imported?.source) ?? { kind: "tool", callId: message.callId };
      data = {
        turn, step: projection.step,
        message: { id: event.payload.messageId, role: "user", content: [{ type: "tool-result", toolCallId: message.callId, content, ...(message.isError ? { isError: true } : {}) }], source },
        ...(imported?.error === undefined ? {} : { error: imported.error }),
        ...(imported?.meta === undefined ? {} : { meta: imported.meta }),
      };
      projection.advanceStep = true;
    }
  }
  const explicitSurfaceOp = "surfaceOp" in event && event.surfaceOp !== undefined
    ? typeof event.surfaceOp === "object" ? Object.freeze({ op: "replace" as const, start: event.surfaceOp.start - 2, end: event.surfaceOp.end - 2 }) : event.surfaceOp
    : undefined;
  // Seal treats an omitted operation on a message event as append. DSH's
  // persisted surface validator requires that default to be made explicit.
  const surfaceOp = explicitSurfaceOp ?? (type === "user/message" || type === "seal/input-pending" || type === "assistant/message" || type === "tool/result" ? "append" : undefined);
  const sourceEventSeqs = "sourceEventSeqs" in event && event.sourceEventSeqs !== undefined ? Object.freeze(event.sourceEventSeqs.map((sequence) => sequence - 2)) : undefined;
  const ignorable = event.type === "dsh.imported" ? event.payload.ignorable === true : !REQUIRED_DSH_SESSION_EVENT_TYPES.has(type);
  return Object.freeze({ seq, time, type, data, ...(ignorable ? { ignorable: true as const } : {}), ...(surfaceOp === undefined ? {} : { surfaceOp }), ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) });
}

function sealContentBlockToDsh(block: import("@seal-harness/core").AgentMessage["content"][number]): JsonValue {
  if (block.type === "text" || block.type === "reasoning") return { type: block.type, text: block.text };
  if (block.type === "tool_call") return { type: "tool-call", id: block.id, name: block.name, arguments: typeof block.providerData?.dshArguments === "string" ? block.providerData.dshArguments : JSON.stringify(block.arguments) };
  if (block.type === "attachment") {
    const imported = block.providerData?.dshAttachment;
    if (typeof imported === "object" && imported !== null && !Array.isArray(imported)) return imported;
    return { type: "image", attachment: { attachmentId: block.id, mediaType: block.mimeType ?? "application/octet-stream", bytes: block.bytes ?? 0, width: block.width ?? 0, height: block.height ?? 0, ...(block.name === undefined ? {} : { name: block.name }), ...(block.originalDimensions === undefined ? {} : { originalDimensions: { ...block.originalDimensions } }) } };
  }
  return { type: "seal/inline-image", mediaType: block.mimeType, data: block.data };
}

function jsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
}

function importDshSeed(values: readonly unknown[]): import("@seal-harness/core").SessionEvent[] {
  let openTurn: number | undefined;
  const toolNames = new Map<string, string>();
  return values.map((value): import("@seal-harness/core").SessionEvent => {
    const event = objectValue(value, "DSH seed event"); const type = stringValue(event.type, "seed event type");
    const data = objectValue(event.data, `seed event ${type} data`);
    if (type === "turn/start" && Number.isSafeInteger(data.turn)) openTurn = data.turn as number;
    const numericTurn = Number.isSafeInteger(data.turn) ? data.turn as number : openTurn;
    const importedTurnId = numericTurn === undefined ? undefined : turnId(`dsh-turn-${numericTurn}`);
    const surfaceOp = normalizeCompatibleSurfaceOp(event.surfaceOp, `seed event ${type}`);
    const sourceEventSeqs = normalizeCompatibleSourceEventSeqs(event.sourceEventSeqs, Number.isSafeInteger(event.seq) ? event.seq as number : Number.MAX_SAFE_INTEGER, `seed event ${type}`);
    const surface = surfaceOp === undefined && sourceEventSeqs === undefined ? {} : {
      ...(surfaceOp === undefined ? {} : { surfaceOp: typeof surfaceOp === "object" ? { op: "replace" as const, start: surfaceOp.start + 2, end: surfaceOp.end + 2 } : surfaceOp }),
      ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs: sourceEventSeqs.map((sequence) => sequence + 2) }),
    };
    if (type === "tool/call" && typeof data.callId === "string" && typeof data.name === "string") toolNames.set(data.callId, data.name);
    if (type === "user/message") {
      const message = dshUserMessage(data);
      return { type: "message.appended", payload: { messageId: message.id ?? messageId(crypto.randomUUID()), ...(importedTurnId === undefined ? {} : { turnId: importedTurnId }), message }, ...surface };
    }
    if (type === "assistant/message") {
      const wire = objectValue(data.message, "assistant/message data.message");
      const metadata = toJsonValue({ ...(data.usage === undefined ? {} : { usage: data.usage }), ...(wire.source === undefined ? {} : { source: wire.source }), ...(data.interrupted === true ? { interrupted: true } : {}) });
      const content = normalizeAssistantContent(arrayValue(wire.content, "assistant message content"));
      const replayState = normalizeDshReplayState(wire.source, content.length);
      const message: import("@seal-harness/core").AssistantMessage = { role: "assistant", content, ...(typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) && Object.keys(metadata).length > 0 ? { providerData: { dsh: metadata } } : {}), ...(replayState === undefined ? {} : { replayState }) };
      return { type: "message.appended", payload: { messageId: typeof wire.id === "string" ? messageId(wire.id) : messageId(crypto.randomUUID()), ...(importedTurnId === undefined ? {} : { turnId: importedTurnId }), message }, ...surface };
    }
    if (type === "tool/result") {
      const wire = objectValue(data.message, "tool/result data.message");
      const blocks = arrayValue(wire.content, "tool result message content");
      const result = blocks.find((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool-result") as Record<string, unknown> | undefined;
      if (result !== undefined && typeof result.toolCallId === "string") {
        const metadata = toJsonValue({ ...(data.error === undefined ? {} : { error: data.error }), ...(data.meta === undefined ? {} : { meta: data.meta }), ...(wire.source === undefined ? {} : { source: wire.source }) });
        const message = { role: "tool" as const, callId: toolCallId(result.toolCallId), name: typeof data.name === "string" ? data.name : toolNames.get(result.toolCallId) ?? "tool", content: normalizeContent(arrayValue(result.content, "tool result content")), isError: result.isError === true, ...(typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) && Object.keys(metadata).length > 0 ? { providerData: { dsh: metadata } } : {}) };
        return { type: "message.appended", payload: { messageId: typeof wire.id === "string" ? messageId(wire.id) : messageId(crypto.randomUUID()), ...(importedTurnId === undefined ? {} : { turnId: importedTurnId }), message }, ...surface };
      }
    }
    if (type === "agent/inbox.spliced" || type === "agent/inbox/spliced") {
      if (data.target !== "next-turn" && data.target !== "next-step") throw new TypeError("seed inbox target is invalid");
      if (!Number.isSafeInteger(data.start) || (data.start as number) < 0) throw new TypeError("seed inbox start is invalid");
      const removedCount = data.removedCount;
      if (removedCount !== undefined && (!Number.isSafeInteger(removedCount) || (removedCount as number) < 0)) throw new TypeError("seed inbox removedCount is invalid");
      const inserted = arrayValue(data.inserted, "seed inbox inserted").map((message) => { const normalized = dshUserMessage(objectValue(message, "seed inbox message")); return normalized.id === undefined ? { ...normalized, id: messageId(crypto.randomUUID()) } : normalized; });
      return { type: "agent/inbox.spliced", payload: { target: data.target, start: data.start as number, inserted, ...(removedCount === undefined ? {} : { removedCount: removedCount as number }), ...(data.outcome === "canceled" ? { outcome: "canceled" as const } : {}) } };
    }
    if (type === "turn/end") openTurn = undefined;
    return { type: "dsh.imported", payload: { type, data: toJsonValue(data) as JsonObject, ...(event.ignorable === true ? { ignorable: true } : {}), ...(typeof event.time === "number" && Number.isFinite(event.time) ? { time: event.time } : {}) }, ...surface };
  });
}

function dshUserMessage(value: Record<string, any>): UserMessage {
  const source = value.source === undefined ? undefined : toJsonValue(value.source);
  if (source !== undefined && (source === null || typeof source !== "object" || Array.isArray(source))) throw new TypeError("seed user message source must be an object");
  return { role: "user", content: normalizeContent(arrayValue(value.content, "user message content")), ...(typeof value.id === "string" ? { id: messageId(value.id) } : {}), ...(source === undefined ? {} : { source: source as JsonObject }) };
}

function normalizeAssistantContent(values: readonly unknown[]): import("@seal-harness/core").AssistantMessage["content"] {
  return values.map((value) => {
    if (typeof value !== "object" || value === null) return text(String(value));
    const block = value as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") return text(block.text);
    if (block.type === "reasoning" && typeof block.text === "string") return { type: "reasoning" as const, text: block.text };
    const image = normalizeDshImageBlock(block); if (image !== undefined) return image;
    if (block.type === "tool-call" && typeof block.id === "string" && typeof block.name === "string") {
      let args: unknown = block.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      const normalized = toJsonValue(args);
      return { type: "tool_call" as const, id: toolCallId(block.id), name: block.name, arguments: typeof normalized === "object" && normalized !== null && !Array.isArray(normalized) ? normalized as JsonObject : {}, ...(typeof block.arguments === "string" ? { providerData: { dshArguments: block.arguments } } : {}) };
    }
    return text(`[DSH assistant content ${String(block.type ?? "unknown")}] ${safeJson(value)}`);
  });
}

function normalizeDshReplayState(source: unknown, contentLength: number): import("@seal-harness/core").ModelReplayState | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return undefined;
  const replay = (source as Record<string, unknown>).replayState;
  if (typeof replay !== "object" || replay === null || Array.isArray(replay) || !Object.prototype.hasOwnProperty.call(replay, "response")) return undefined;
  const blocks = (replay as Record<string, unknown>).blocks;
  if (blocks !== undefined && (!Array.isArray(blocks) || blocks.length !== contentLength)) return undefined;
  return { response: toJsonValue((replay as Record<string, unknown>).response), ...(blocks === undefined ? {} : { blocks: blocks.map(toJsonValue) }) };
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function objectValue(value: unknown, name: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, any>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined, id: string): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error(`agent "${id}" creation aborted`, { cause: signal.reason });
}

function sealReasoning(value: string): "off" | "low" | "medium" | "high" | "max" {
  if (value === "off" || value === "none") return "off";
  if (value === "minimal" || value === "low") return "low";
  if (value === "medium") return "medium";
  if (value === "high") return "high";
  if (value === "xhigh" || value === "max" || value === "ultra") return "max";
  throw new TypeError(`unsupported reasoning effort: ${value}`);
}

function positiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("startupTimeoutMs must be a positive finite number");
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizeDshSessionMeta(meta: Record<string, unknown>, inheritedEventCount: unknown, seed: readonly unknown[]): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  if (meta.parentSession !== undefined) result.parentSession = stringValue(meta.parentSession, "meta.parentSession");
  if (meta.isSeeded !== undefined) {
    if (typeof meta.isSeeded !== "boolean") throw new TypeError("meta.isSeeded must be a boolean");
    result.isSeeded = meta.isSeeded;
  }
  if (meta.origin !== undefined) {
    if (meta.origin !== "subagent") throw new TypeError("meta.origin must be subagent");
    result.origin = "subagent";
  }
  if (meta.delegationDepth !== undefined) {
    if (!Number.isSafeInteger(meta.delegationDepth) || (meta.delegationDepth as number) < 0) throw new TypeError("meta.delegationDepth must be a non-negative safe integer");
    result.delegationDepth = meta.delegationDepth as number;
  }
  if (meta.agentPreset !== undefined) result.agentPreset = stringValue(meta.agentPreset, "meta.agentPreset");
  if (inheritedEventCount !== undefined) {
    if (!Number.isSafeInteger(inheritedEventCount) || (inheritedEventCount as number) < 0 || (inheritedEventCount as number) > seed.length) throw new TypeError("inheritedEventCount must be a non-negative safe integer within the seed");
    if (result.isSeeded !== true) throw new TypeError("inheritedEventCount requires meta.isSeeded");
    result.inheritedEventCount = inheritedEventCount as number;
  }
  for (const [key, value] of Object.entries(meta)) {
    if (key === "cwd" || key in result) continue;
    const normalized = toJsonValue(value);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function assertToolRisk(value: unknown, field: string): asserts value is ToolRisk {
  if (!(value === "read" || value === "workspace-write" || value === "external" || value === "dangerous")) {
    throw new TypeError(`${field} must be read, workspace-write, external, or dangerous`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
