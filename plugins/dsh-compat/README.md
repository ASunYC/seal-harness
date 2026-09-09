# @seal-harness/dsh-compat

Optional compatibility host for DeepSeek Harness plugins built on
`@deepseek-ai/cordis`.

The package runs plugins on a real Cordis `Context`. Function, class, object and module-style
plugins keep their Cordis `apply`, `inject`, `Config`, event, service, Fiber and Effect semantics.
The package is not part of the default Seal Harness Profile or self-contained launcher closure.

## Profile usage

```js
import * as myDshPlugin from "my-dsh-plugin";
import { dshCompatPlugin } from "@seal-harness/dsh-compat";
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";

export default defineProfile([
  // Add the normal Seal Harness model, session, context, policy, tools,
  // runtime and agent plugins first.
  plugin(dshCompatPlugin, {
    plugins: [{ plugin: myDshPlugin, config: {} }],
    defaultToolRisk: "external",
    toolRisks: { trusted_read_tool: "read" },
  }),
]);
```

The same compatibility host can boot an existing Cordis configuration tree with the official
DeepSeek Loader, Include, and Group plugins:

```js
plugin(dshCompatPlugin, { configFile: "./cordis.yml" })
```

Relative paths resolve from the launching working directory. Direct `plugins` and `configFile` may
be combined; Loader settlement is part of startup, so a broken tree fails the Profile atomically.
Official module and configuration hot replacement is opt-in:

```js
plugin(dshCompatPlugin, { configFile: "./cordis.yml", hmr: { roots: ["src", "cordis.yml"] } })
```

Run the Profile with:

```sh
seal-harness --config ./seal-harness.config.mjs "Use the compatible plugin"
```

## Compatibility boundary

Supported:

- real Cordis plugin forms and `inject` dependency waiting;
- the official Typert schema/reflection registry, Loader artifact discovery, and local Remote dispatcher
  when the surrounding Seal Host does not already own the gateway;
- Standard Schema `Config` validation performed by Cordis;
- Cordis services, events, Fiber disposal and `ctx.effect()` cleanup;
- official `cordis.yml` Loader, Include, Group and opt-in source/config HMR;
- DSH-shaped browser boot manifest and two-stage client module graph with package dependency ordering,
  dynamic `external` arrival, `/client` normalization, observed require edges, cycle detection,
  graph-sensitive shared initial batches, single-package HMR reloads, and dependent-cascading HMR;
- raw or `defineTool()`-produced DSH tools registered through `ctx.tools`;
- ToolRuntime `get()`, `schemas()`, `guard()`, and `restrict()` projections, plus explicit
  `tools.scope(sessionId)` registration/restriction/guard isolation through Seal `ownerSession`;
- the official isolated TypeScript worker-thread `codeRuntime`, enabled by default and configurable
  with `codeRuntime` compute, wall-clock, output, and heap limits (or disabled with `false`);
- the official Storage hub, JSON backend, and schema-validated Domain form, persisted under
  `$DSH_HOME/storages` by default and configurable through `storage`;
- an `agents` identity/scope bridge with `get`, `list`, `adopt`, initiator propagation, paired
  lifecycle events, single-factory `setFactory`, transactional built-in `create`/`resume` with
  unpublished setup/commit and rollback, atomic seeded-history import across every Session backend,
  validated and restart-safe DSH Session header metadata (`cwd`, lineage, seeded state, origin,
  delegation depth, agent preset, and inherited-event count),
  type/data-preserving log-only storage for non-surface DSH seed records, mirrored Seal
  session log facades with synchronous append/range/history access, durable surface replacement
  metadata, and paired session/agent creation and disposal notifications,
  an official-backed `ctx.sessions` service whose standalone and Agent-owned sessions share
  `get`/`list`/`flush`/`fork` discovery,
  official `systemPrompt` and `sessionProjections` registries, with prompt sections, variables,
  dynamic context, waterfalls, and projection folds connected to live Seal Agent requests,
  an official DSH `llm` runtime backed by Seal model discovery and streaming, including
  reasoning, tool calls, usage, finish reasons, and `llm/stream` middleware,
  the official per-Agent repeat-tool reminder, with canonical argument matching, configurable
  thresholds and filters, user-interjection reset, and next-request notice contexts,
  the official local filesystem capability and hierarchical AGENTS.md/CLAUDE.md instruction
  projection, including bounded baseline discovery and post-tool filesystem reconciliation,
  the official `read`/`write`/`edit` filesystem tools over that capability, with conditional
  `read_image` registration when durable attachments are available,
  the official collision-aware `str_replace_editor` for bounded views, create-if-absent,
  unique literal replacement, and line insertion over the same filesystem,
  the official per-Agent filesystem observation policy, enforcing read-before-edit and
  observed-version compare-and-swap so external changes reject stale mutations,
  the official sandboxed filesystem backend whenever a sandbox policy is active, fencing write/edit
  per call while leaving reads available and exposing one-shot escalation fields through the standard tools,
  the official local subprocess runtime, PowerShell tool, and packaged-ripgrep `glob`/`grep`
  tools, with bounded command and search output; when Seal Jobs exists, DSH background PowerShell
  uses that same owner-scoped registry and remains controllable through Seal's native job tools,
  the corresponding official local/sandboxed Bash executor and `bash` tool on Linux and macOS,
  an event-sourced official `todo_write` fallback when Seal has not already registered the same
  tool, preserving the native tool as authoritative in full Seal compositions,
  plus the official logged plan-mode controller and review tool as a collision-aware fallback,
  official per-session sandbox policy, enforcing PowerShell composition, and durable permission
  presets whenever a Seal sandbox backend is present,
  the official file settings provider sharing Seal's configured settings document when available,
  the official layered skill registry, filesystem provider, durable session catalog, explicit
  `/skill-name` injection, and policy-routed model-facing `skill` loader tool,
  official cooperative per-tool deadlines plus private session-scoped spill storage and bounded
  oversized plain-text result projections,
  the official worker-thread workflow engine and model-facing orchestration tool over Seal's
  ownership-aware subagent provider, with bounded concurrency and durable parent-session records,
  structured fresh Seal child results through a session-isolated, schema-validated
  `structured_output` tool, plus the official collision-aware Ralph iteration loop,
  official continuation controls for listing, messaging, and interrupting live or resumable subagents,
  a Seal AgentService bridge preserving turn/step, inbox, and lifecycle semantics;
  executable Agents always use Seal's Pi runtime and have no DSH loop fallback,
  the default official DeepSeek V4 LLM provider for standalone hosts, with native reasoning and multimodal Files API,
  credential resolution, live settings, and provider retry behavior,
  the official generic pi-ai LLM adapter mounted dormant by default until settings declare provider routes,
  and a transactionally accepted
  registry for independently owned DeepSeek request-extension fields, plus an opt-in lossless
  incremental canonical Session-log contribution with acceptance watermarks,
  plus Loader-derived package provenance on official DeepSeek requests whenever a Cordis config tree is active,
  the default owner-only local YAML credential provider with atomic updates and optional hot reload,
  the default content-addressed local image store with official admission and normalization limits,
  opt-in read-only import and execution of existing Claude Code and Codex command-hook configurations,
  opt-in generic ACP, native Claude Code/Codex, and isolated DSH SDK out-of-process subagent providers,
  the official in-process spawn and completed-turn-prefix fork providers by default for standalone hosts,
  the optional official bundled `dsh-badge` provider (disabled by default) alongside filesystem-discovered skills,
  the official fail-closed local sandbox selector, including Windows ACL capabilities, Linux Landlock/bwrap,
  and macOS Seatbelt, while preserving an installed Seal sandbox as the authoritative provider,
  an explicit opt-in official E2B world whose filesystem, subprocess, Bash, and terminal adapters share one remote Linux sandbox and cwd,
  the official race-fenced goal-round driver for durable automatic same-session continuation,
  the official authority-checked model-facing goal tools when Seal does not already own those names,
  official durable per-step time and browser-time-zone context,
  an opt-in owner-scoped persistent PowerShell tool whose state survives consecutive calls,
  bounded cross-Session references with durable untrusted snapshot context,
  the DSH-base search-disabled in-memory SQLite query backend for standalone hosts, while Seal SessionStore deployments retain a same-authority query bridge; explicit SQLite FTS5 configuration enables full search semantics,
  the official `$DSH_HOME/sessions` JSONL backend by default for standalone hosts, with packed chunks and Zstandard or plain encoding, while Seal SessionStore deployments retain their persistence bridge,
  configurable official Harness identity, deployment persona, runtime context, and tool ordering,
  the official owner-scoped persistent terminal registry, local shell backend, and terminal tools when names are available,
  the official LSP service and model tool, losslessly bridged to Seal's compatible LSP seam when installed,
  the official per-root-Agent durable Schedule runtime when Seal does not already own the schedule tool names,
  opt-in official stdio and Streamable HTTP MCP clients with canonical names, initial synchronization, and bounded reconnect backoff,
  the official Web provider registry with the DSH-base `deepseek-official` search and anonymous HTTP fetch defaults,
  opt-in Exa/Perplexity providers, and bounded web_search/web_fetch tools (60-second default search budget) when names are available,
  official Session telemetry capture with `DSH_TELEMETRY_MODE`, `DSH_TELEMETRY_OTLP_URL`, and `DSH_TELEMETRY_DISABLED` compatibility, an explicit FULL/FEEDBACK_ONLY opt-in OTLP backend, and a non-uploading fallback,
  the official lazy local attachment store by default when Seal does not provide attachment authority,
  the official managed credential provider and authorization seam by default when Seal does not provide credential authority,
  the official hot-reloaded `$DSH_HOME/settings.yaml` provider and settings controller by default,
  official per-Agent local @path discovery with bounded indexing, exclusions, invalidation, and scoped prompt guidance,
  official job_output/job_list/job_kill controls with owner filtering and bounded completion wake delivery,
  the official process-local job registry when Seal does not provide a shared JobService,
  official cross-Session search, lineage trace, event relationship trace, and exact event-read tools,
  a Seal-backed `sessionPersistence` service supporting both current handles and the legacy
  inspection/read-model contract, with serialized write ownership, revision snapshots, and
  capability-gated raw artifact access from the JSONL backend,
  the official live-preferred `sessionQuery` read/trace/filter engine plus a bounded linear
  full-text provider for session/event search across live and persisted Seal logs,
  an official-shape `attachments` store over Seal attachment persistence, including image
  limits, format/dimension validation, durable reads, and browser subagent image admission,
  the official package-owned runtime `invariants` registry with filtering and scoped teardown,
  writable DSH `credentials` references and structured API-key/grant records over capable Seal
  providers, with accurate read-only reporting for environment overrides and update notifications,
  a Typert-visible `messageFeedback` bridge over Seal's native durable feedback truth, with an
  opt-in official Storage sidecar fallback when no native service exists,
  an opt-in deployment-level official Web `/export` command and `/api/session.export` ZIP route
  for Session logs, descendants, and referenced attachments when Connection is available,
  an official-shape DSH sandbox provider delegating confinement and enforcement evidence to Seal,
  the official DSH approval policy/audit service with its answer waterfall backed by Seal approval,
  official scoped `userQuestions` validation and root-agent ownership backed by Seal structured questions,
  the official revisioned DSH `goals` lifecycle over compatible durable Agent sessions,
  the official replay-aware `tokenMeter` plus BasicCompactionEngine over the bridged LLM,
  a `subagents` bridge with a built-in `seal` provider for caller-reserved identities,
  continuable creation, bidirectional owned messaging, browser control, interruption,
  direct-child listing, descendant traversal, and one-shot run handles,
  plus the official model-facing one-shot `subagent` tool over that provider; Seal's native
  `subagent_fork` uses a separate completed-turn inheritance provider, preserving the parent's
  finished transcript while excluding its active tail and assigning fresh child ownership metadata;
  `list_agents`, `send_message`, and `interrupt_agent` remain authoritative to avoid duplicate names,
  runtime `running`/`idle` state, `maxTokens` preservation, active-run
  `cancel`/`whenIdle`/`runMaintenance`/`followup`/`steer`/`send`, full
  ordered two-list Inbox mutation backed by atomic runtime splice, cross-list id uniqueness, durable
  `agent/inbox.spliced` records with optimistic-conflict retry, run-end flush barriers, and
  log-folded restart/resume recovery,
  idle wakeup on the last durable model route, queued non-waking context injection, and automatic
  `agent.ctx` ToolRuntime ownership;
- scoped live `agent/inbox/inserted`, `agent/inbox/claimed`, `agent/inbox/discarded`, and
  `agent/error` notifications, including mutations initiated outside the Cordis bridge;
- Agent-scoped `agent/request` waterfall dispatch at the real provider boundary, including
  sticky provider/model, reasoning-effort, and max-token replacement for later steps;
- Agent-scoped `agent/pre-step` waterfall dispatch before provider I/O, with input replacement
  reflected in both the live model context and durable Session surface, and provider-free rejection;
- Agent-scoped `agent/request-error` recovery before terminal request settlement; returning
  `{ kind: "retry" }` repeats selection and the provider attempt in the same turn/step;
- awaited Agent-scoped `agent/turn-stopping` delivery before the turn closes, with a fresh
  steering-queue read so listeners can extend the turn through `agent.steer()`;
- PTC `toolPresentation: "ptc" | "both"`: `ptc` exposes only `run_code` to the model while its
  worker bindings call hidden Session-visible tools through the normal Seal policy pipeline; the
  system prompt uses DeepSeek's official `renderToolsSdk()` output for the effective tool schemas;
  Agent Presets may also mount the official `dsh-agent-tool-presentation` row, whose mode follows
  the standing-preset scope chain and remains isolated between concurrent Sessions;
  nested calls persist native `tool/code-dispatch-start` and `tool/code-dispatch` records with
  deterministic submission-order ids and complete error outcomes;
- Seal Harness Policy and Approval routing for every bridged tool;
- opt-in official Dynamic Cordis Host Runner and `cordis_inspect_*` / `cordis_define` / `cordis_run` /
  `cordis_stop` / `cordis_undefine` toolset through `dynamicCordis: {}`, disabled by default because it
  executes model-authored plugin code;
- browser `remote.dynamicCordisRunner` coverage for inventory, Host-half lifecycle, approval settlement,
  client-source retrieval, inspect synchronization, guarded invocation, failure reporting, stop, and removal;
- a browser `loader.create/resolve/remove` facade for Dynamic Cordis factories, including pending inject
  declarations, awaited activation, disposal, and legal re-registration;
- automatic loading of the official Dynamic Cordis Client Runner inside a real Cordis browser context whenever
  the Host capability is enabled, including official `dyn/*` plugin fibers, client inspect synchronization,
  and the official UI Cordis panel/tool faces and input-trigger source;
- `deferContext()` and `concludeTurn()` Agent-loop control semantics;
- same-origin Host routes, browser client bundles, live enable/disable reconciliation, and the
  browser `locale` injection adapter;
- browser `remote.commands`, `remote.settings`, `remote.agentPresets`, `remote.goals`,
  `remote.messageFeedback`, `remote.subagents`, `remote.sessionReferenceResolver`, `remote.fileReferences`,
  `remote.workspace`, `remote.llm`, `remote.credentials`, `remote.skills`, `remote.directoryPicker`, and
  `remote.pluginInventory` adapters with DSH `RemoteResult` failures, cancellation, and
  domain-specific conflict details;
- browser `remote.session` list, model catalog, durable model selection, idempotent create, rename,
  completed-turn fork, and Session-addressed cancellation, including live running/blank and
  subagent-parent metadata;
- browser `remote.session.prompt` for background admission, active-run queue/steer delivery,
  durable `user-rpc` request correlation, validated time zones, text, and durable image content,
  including reference-preserving inline projection for images queued onto a live Pi run;
- browser `remote.session.search` with visible, current-surface message matching and DSH result bounds.
- browser `remote.session.attachment` with Session reachability authorization, SHA-256 verification,
  byte-verified PNG/JPEG/GIF/WebP dimensions, and base64 payloads.
- browser `remote.session.page` and streaming `remote.session.follow`, backed by a deterministic,
  dense DSH wire projection with message-aligned pagination, gap-free append delivery, and resolved
  attachment MIME, byte length, and image dimensions;
- browser `remote.session.control` and `updateQueue`, using the actual Pi inbox for stable-id
  queue snapshots, edits, removals, steering promotion, cancellation parking and DSH/Web wakeup, plus
  owner-scoped Job and `sessionListMetadata`/`modelSelection`/enforced `imageLimits` projection updates;
- generic Host/Client Connection RPC channels with DSH-compatible request/response envelopes,
  shared `/api` endpoint interception and exact Fetch routes, correlation-id verification, target
  validation, transport failures, cancellation propagation, and a fence around Seal core routes;
- Host `webServer.registerUpgrade()` with exact-path ownership, lifecycle disposal, and the
  authenticated raw socket/head contract required by the DSH Remote stream mux;
- a DSH-compatible `/api/remote.mux` physical carrier with multiplexed `open`, `cancel`, `item`,
  `end`, and `error` frames for the Session follow/control and `$events` streams;
- observable Client Connection generation/state, reconnect recovery, `connection/reset`, and
  `remote.$on()` delivery for Host broadcast events;
- `typertGateway.registerRemoteEvents()` plus Agent-scoped waterfall delivery and correlated
  `$events/result` settlement (`next`, `result`, and `rejected`) with cancellation propagation;
- a shared React 19 runtime and `slots` service implementing declared child ownership,
  single/keyed/list/chain dispatch, priority/order, fallback, locale and observable Hook injection,
  with Fiber/HMR-scoped cleanup.

Not emulated:

- DSH Connection services that do not have a Seal adapter;
- DSH Agent Loop execution, including standalone fallback and DSH SDK child processes;
- DSH first-party services other than adapters explicitly supplied through `services`.

Plugins requiring additional named Cordis services can receive explicitly trusted adapters through
the `services` configuration field. A DSH plugin is trusted Node.js code and is not sandboxed by this
compatibility host.
- Host `webServer.registerUpgrade()` with exact-path ownership, lifecycle disposal, and the
  authenticated raw socket/head contract required by the DSH Remote stream mux;
