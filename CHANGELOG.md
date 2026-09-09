# Changelog

All notable changes to Seal Harness will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses Semantic Versioning for published packages.

## [Unreleased]

### Changed

- Restored Seal's default product shell with its Team panel. Kept DSH plugin compatibility on Seal/Pi, removed the DSH Agent Loop fallback and DSH SDK subprocess dependency chain, and verified time-context and goal-round behavior with the real Pi runtime.

- Added DeepSeek Harness Agent Teams semantics from the upstream experimental source: durable named teammates, peer mailbox recovery, CAS task DAG, the exact nine-tool catalog and policy, plus an official-shell Team panel and Web API.
- Added a provider-neutral webhook rule runtime and optional signed GitHub HTTP adapter.
- Added an optional LSP provider seam, generic stdio host, and bounded model-facing navigation tool.
- Added provider-neutral web search/fetch, a public-network-safe HTTP fetcher, optional Exa search, and model-facing web tools.
- Added an opt-in official E2B composition with one shared remote filesystem and subprocess world.
- Fixed official Web startup with an existing workspace: Session Controller-owned preset setup no longer double-binds the Agent scope, the fallback Seal shell no longer runs hidden global dialogs behind the official shell, and the immutable import map is admitted by CSP without enabling arbitrary inline scripts.
- Made the authenticated Web App Manifest request include the established session cookie, and expanded the real-browser official-shell smoke test to reject HTTP errors, clipped layouts, and visible legacy dialogs.
- Aligned Profile boot with DeepSeek Harness proxy handling so built-in fetch, LLM, MCP, telemetry,
  and plugin traffic consistently honor standard proxy and bypass environment variables.
- Added first-run DeepSeek credential onboarding and made built-in provider credentials use the
  local credential service with configured/source/writable discovery instead of process-only state.
- Aligned the SDK transport with JSON-RPC 2.0 framing and structured error responses while retaining
  compatibility with legacy Seal RPC peers that omit the version or return string errors.
- Added the exact published DeepSeek Harness Renderer, Layout, Sidebar, Slots, and Store client
  packages plus a real-Cordis ABI integration gate covering activation, root/sidebar rendering,
  locale/session scope wiring, and new-session dispatch. The production browser now also activates
  an isolated official shell composition and exposes an explicit mount face while the visible Seal
  shell remains in place until the official conversation stack is wired.
- Added the production `uiWorkspace` bridge with current/recent Workspace inheritance, blank-Session
  reuse, official Remote creation, archive/directory actions, and navigation into the existing shell.
- Activated the exact published official Session Controller plus UI Session, Conversation, and Chat
  packages in the isolated production Cordis composition. The preview now consumes the official
  reconnecting control stream, Session history journal, projection readers, queue, cancellation,
  command, search, and fork faces instead of a static Seal-side Session approximation.
- Replaced the official preview's Seal-side Workspace projection and navigation shim with the
  published Workspace Controller and UI Workspace packages, and activated the published official
  brand, attachment, Tool tree, deliverables, and trajectory conversation surfaces.
- Replaced the preview's simplified settings and input-trigger services with the published Settings
  Controller, General/Models/Plugins/Inventory pages, Input Trigger, Commands, Skill, Reference,
  and Subagent packages; also activated the official Approval and User Questions waterfall UI.
- Activated the published Model Selection, Permission Presets, Plan, Goal, Jobs, Message Feedback,
  Schedule, Agent Preset, Workflow Run, and browser Directory Picker client surfaces in the
  official composition, using the existing aligned Remote namespaces and Session projections.
- Made the complete official composition the default Web shell after auditing all 35 upstream UI
  entries; the former Seal shell remains available through `#seal-shell` and remains visible if the
  official composition does not reach its ready state. Dynamic Cordis Runner ownership follows the
  selected shell so dynamic Slots and waterfall events cannot split across two roots.
- Added a dependency-free Chromium CDP smoke command for the official shell. It verifies real module
  loading, ready/mounted diagnostics, legacy-root hiding, required controller/UI activation, visible
  content, and a clean browser console; the check exposed and removed a duplicate directory-flow slot.

- Added custom OpenAI/Anthropic-compatible provider construction and remote model discovery;
  discovered models are registered in the live model service and can be called immediately from
  the Web UI, while credentials remain process-local.
- Added `@seal-harness/sdk`, a high-level TypeScript API with subprocess ownership, initialize
  handshake, reusable sessions, streaming notifications, result collection, diagnostics, and
  bounded graceful shutdown.
- Added a standard-library-only Python SDK with equivalent synchronous runs, named sessions,
  notification callbacks, diagnostics, and context-managed subprocess cleanup.
- Added an official-SDK-based ACP stdio server with negotiation, persistent session lifecycle,
  prompt streaming, tool updates, cancellation, and client-mediated one-shot permissions; the
  unified launcher now exposes `seal-harness acp`.
- ACP new/resume now mounts stdio and Streamable HTTP MCP servers into Session-owned tool scopes;
  connections and definitions are removed on close and cannot leak into other Sessions.
- ACP session listing now includes active Sessions and supports deterministic opaque keyset
  pagination with configurable page size.
- ACP Sessions now expose grouped Model and Reasoning configuration options, accept serialized
  `session/set_config_option` mutations, and persist the selected route across close/resume.
- Concurrent ACP resume requests for the same Session now have a single activation winner;
  close also drains queued configuration persistence before releasing Session resources.

- Aligned the Web Models settings with the active Profile catalog: providers are now discovered
  from `ModelService` instead of a hard-coded list, per-provider model choices persist locally,
  and the selected model shows its route, token capacities, reasoning, and image capabilities.

- Added a DSH-compatible Web DOM surface so client themes can mount their character stage,
  sidebar chrome, conversation state and composer decorations instead of merely changing colors.

- Renamed the project, npm scope, CLI, environment variables, data directories, configuration
  files, Web UI, documentation, and release assets from Seal Harness's former name to
  `seal-harness` / `@seal-harness/*`.
- Raised all workspace package versions to `0.2.0` for the breaking rename.

### Added

- Durable root-Session schedules with delayed, offset/IANA absolute, and fixed-rate rules;
  restart recovery, missed-occurrence advancement, and atomic dispatch-plus-prompt persistence.
- Worker-isolated `workflow` orchestration with agent/parallel/pipeline/phase/log hooks,
  structured child results, resource caps, cancellation propagation, child reaping, and durable
  parent-Session lifecycle records.
- Workspace-authorized historical Session tools matching the DSH surface: `session_search`,
  `session_event_search`, `session_trace`, `session_event_trace`, and `session_event_read`, with
  lineage, time/type/surface filters, bounded output, and no historical Agent activation.
- Persisted same-Session goals with compare-and-set revisions, lifecycle validation,
  process-local activation, fork-safe replay, and `get_goal`, `create_goal`, and `update_goal`.
- Automatic same-Session goal continuation with retained round prompts, admission counting,
  model-route reuse, and durable round-limit blocking.
- Session-owned `todo_write` whole-list replacement with strict validation, configurable parallel
  in-progress policy, durable replay, and next-turn standing-plan expiry.
- Durable per-Session Plan Mode with conditional prompt guidance, stable reviewed
  `exit_plan_mode`, fork inheritance, and Web/RPC state endpoints.
- Fail-closed process sandbox seam with probed Linux bubblewrap/Landlock, macOS Seatbelt, and the
  DeepSeekHarness Windows ACL restricted-token backend; workspace shell and persistent PTY
  launches now carry sandbox mode and enforcement facts.
- A live per-Session Web activity rail for Goal, Plan, Todo, Jobs, Subagents, and Terminals,
  including Plan Mode controls, full-markdown plan review cards, and owner-scoped cancellation
  controls for active Jobs, Subagents, and Terminals.
- Durable background child Agents with parent-owned Session metadata and `spawn_agent`,
  `list_agents`, `wait_agents`, `send_message`, and `abort_agent` control tools.
- Session-owned background job registry with concurrency limits, incremental output, waiting,
  cancellation, and the DSH-style `job_list`, `job_output`, `job_wait`, and `job_kill` tools.
- Real cross-platform persistent PTY sessions backed by `node-pty`, with bounded incremental
  output, Session ownership, Job integration, and terminal start/send/read/list/kill tools.
- LLM-backed conversation compaction using the active model route, isolated from the Agent loop
  and tool surface, with cancellation propagation and deterministic window fallback.

- DSH-inspired product shell with a fixed Settings entry and General, Models, and Plugins pages.
- Loopback-only Web plugin management APIs and searchable plugin cards with install, enable,
  disable, diagnostics, and remove controls.

- DSH-compatible `seal-harness plugin` commands for isolated Profile installation, listing,
  diagnostics, enable/disable and removal.
- Efficient GitHub `#path:` installation through a partial, runtime-file-only checkout.
- Web Host and browser Client plugin loading, DSH `webServer` route bridging, and native theme
  selection for installed DSH skins.

- Optional `@seal-harness/dsh-compat` host backed by real Cordis 4.0.1, including DSH
  `apply`/`inject`/`Config` lifecycle support and Policy-routed DSH tool bridging.
- Packed-install coverage and compatibility documentation for DSH plugins.

- Rounded seal mascot artwork used by the Web UI, favicon, README, and self-contained releases.

- Zero-runtime-dependency plugin microkernel and native ESM Profiles.
- Provider-neutral Agent, Model, Session, Tool, Policy, Context and Telemetry contracts.
- Pi Agent runtime and Pi AI Provider adapters.
- Fully replaceable scripted Runtime with no Pi or ModelService dependency.
- JSONL, Memory and SQLite Session stores with fork and recovery semantics.
- Policy-routed workspace and MCP tools.
- Headless CLI, JSONL RPC, filesystem Skills and offline scripted model.
- Awaited durability barriers, deterministic Compaction and interrupted-tool recovery.
- Local-first Web UI with streaming runs, model and workspace selection, Session browsing,
  in-memory credentials, cancellation, and browser-based approvals.
- Unified `seal-harness run|headless|web` product launcher.
- Self-contained Windows, Linux, and macOS release bundles with an embedded Node.js runtime,
  archive extraction smoke tests, and SHA-256 checksums.
- Double-click `Start Seal Harness.cmd` entry in every Windows release while retaining the full CLI.
