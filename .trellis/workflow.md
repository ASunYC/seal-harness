# Development workflow

Read the root `AGENTS.md` first. Preserve user changes and use the existing authorization for this task. A request to implement or migrate authorizes ordinary reversible work needed to finish it. A request for a plan only does not. Task management never grants permission to push, publish, or edit another owner's paths.

## Trellis system

Run commands from the repository root with Python 3. The copied Trellis tools need no new application dependencies.

```bash
python3 .trellis/scripts/get_context.py
python3 .trellis/scripts/get_context.py --mode packages
python3 .trellis/scripts/get_context.py --mode phase --step 2.1 --platform codex
python3 .trellis/scripts/task.py --help
```

Initialize a developer identity only if needed with `python3 .trellis/scripts/init_developer.py <name>`. `.trellis/.developer` and `.trellis/.runtime/` are local state; `.trellis/workspace/` contains developer journals. Historical journals and completed tasks from the old checkout are not imported.

Specs currently use the shared `general` layer. Read `.trellis/spec/general/index.md`, then the relevant guides under `.trellis/spec/guides/`. Add package-specific specs when a real package requires them, without duplicating common rules.

Tasks live under `.trellis/tasks/MM-DD-name/`. `task.json` carries state; `prd.md` carries requirements. Complex work also has `design.md` and `implement.md`. Research and context manifests are optional as described below.

```bash
python3 .trellis/scripts/task.py create "<title>" --description "<one-line summary>" --slug <name>
python3 .trellis/scripts/task.py current --source
python3 .trellis/scripts/task.py start <task-dir>
python3 .trellis/scripts/task.py list
python3 .trellis/scripts/task.py finish
python3 .trellis/scripts/task.py archive <task-dir>
```

`create` writes a planning task and can set the session pointer. `start` marks it `in_progress`. The pointer is session-scoped, using hook context, `TRELLIS_CONTEXT_ID`, or a platform session identity. If identity is unavailable, follow the command's hint; do not guess another session's active task. `finish` clears the pointer without completing the task. `archive` marks it completed and moves it under `tasks/archive/`; use it only after acceptance criteria pass.

Journal and archive scripts use Trellis’s default automatic commits for their own paths. Record a useful session with:

```bash
python3 .trellis/scripts/add_session.py --title "<title>" --commit "<hashes>" --summary "<actual progress>"
```

Journals are versioned per developer. The journal rotates at 2000 lines. Record completed checks, remaining work, and blockers without claiming unfinished work is done.

## Phase Index

1. Plan: classify the request, write the necessary artifacts, and activate the task.
2. Execute: implement the approved scope and run checks against the real artifact.
3. Finish: update affected specs, make authorized stage commits, then report or archive.

Small edits or conversation do not require a task. Substantial work uses a task unless the user opts out. Existing implementation/migration authorization is sufficient to create and start it after writing the plan. Ask only when a material decision remains unresolved or the user requested a review boundary.

| Artifact | Responsibility |
| --- | --- |
| `prd.md` | Requirements, exclusions, acceptance criteria |
| `design.md` | Boundaries, interfaces, data flow, compatibility and rollback |
| `implement.md` | Ordered stages, owner boundaries, validation and current progress |
| `research/` | Findings needed later, with evidence and unresolved questions |
| `implement.jsonl`, `check.jsonl` | Optional spec/research context for delegated work |

Use Trellis’s default Codex `auto` dispatch: implementation and checking use the available Trellis agents with curated context. Respect host restrictions on delegation and execute inline when agents are unavailable. Never recursively delegate a unit already assigned to you.

[workflow-state:no_task]
Classify the request. Skip task creation for conversation or small edits. For substantial authorized work, create a task and write its plan without asking again. Respect a no-task or planning-only instruction.
[/workflow-state:no_task]

[workflow-state:task_error]
The active task record could not be read. Do not create or activate another task.
Inspect the task directory named above and repair its task.json. It must be a valid JSON object with a non-empty status.
Preserve existing task fields and artifacts. If the correct status cannot be determined safely, ask the user before reconstructing the record.
[/workflow-state:task_error]

[workflow-state:planning]
Read trellis-brainstorm as needed. Complete prd.md, plus design.md and implement.md for complex work. Continue under existing implementation authorization; pause only at an explicit review boundary or unresolved material decision. Configure manifests if delegating, then run task.py start.
[/workflow-state:planning]

[workflow-state:planning-inline]
Complete prd.md, plus design.md and implement.md for complex work. Existing implementation authorization is sufficient to start after planning. Respect explicit plan-only requests. Inline work reads the relevant specs directly.
[/workflow-state:planning-inline]

[workflow-state:in_progress]
Read task artifacts and relevant specs, implement within scope, run meaningful checks, and update specs when needed. Use the applicable Trellis dispatch mode. Make authorized code commits; journal and archive scripts may commit their own paths. Do not archive incomplete tasks.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Read trellis-before-dev, implement directly, use trellis-check, run applicable checks, and review spec updates. Make authorized stage commits without repeating approval. Report actual results; archive only completed tasks.
[/workflow-state:in_progress-inline]

[workflow-state:completed]
Verify acceptance evidence before archiving with. Report commits, checks, and any unverified platform behavior. Record useful session progress in the developer journal.
[/workflow-state:completed]

Route unclear requirements to `trellis-brainstorm`, edits to `trellis-before-dev`, reviews to `trellis-check`, repeated debugging to `trellis-break-loop`, durable lessons to `trellis-update-spec`, and wrap-up to `trellis-finish-work`.

Read detailed steps with `python3 .trellis/scripts/get_context.py --mode phase --step <X.Y> --platform codex`. Required steps apply to tasks using this workflow; do not repeat a step whose output is already current.

## Phase 1: Plan

#### 1.0 Create task `[required · once]`

Inspect `task.py current --source` and reuse a matching active task. Otherwise create a task for substantial authorized work. `--slug` takes a name without a date prefix. Do not import completed tasks from another checkout.

Use parent/child tasks only for independently verifiable deliverables. Create children with `task.py create "<title>" --description "<one-line summary>" --slug <name> --parent <parent-dir>` or link them with `task.py add-subtask <parent> <child>`. Write dependencies in each child's artifacts; tree position is not a dependency engine. Start the task that owns the next work unit.

#### 1.1 Requirement exploration `[required · repeatable]`

Inspect repository evidence before asking questions. Use `trellis-brainstorm` when intent needs exploration. Keep requirements and acceptance criteria in `prd.md`; put technical decisions in `design.md` and the execution checklist in `implement.md`. Complex tasks require all three before implementation. Update them when the user changes scope.

#### 1.2 Research `[optional · repeatable]`

Search existing code, public extension contracts and installed dependencies first. For this downstream product, prefer plugins, bundles and profiles to upstream source changes. Persist consequential findings under the task's `research/`, or in `design.md` when a separate file adds no value. External information must identify its source and version. Do not treat old-checkout runtime evidence as current acceptance.

#### 1.3 Configure context `[required when delegating]`

Inline work reads artifacts and specs directly. For authorized delegation, give each worker a bounded scope and an explicit `Active task: <path>` line. Curate `implement.jsonl` and `check.jsonl` with repository-relative spec/research paths:

```json
{"file":".trellis/spec/general/desktop-build.md","reason":"Product and upstream build boundaries"}
```

Use `task.py add-context <task> implement <file> <reason>`, `task.py list-context <task>`, and `task.py validate <task>`. Populate both manifests with real entries before `task.py start` in auto mode; remove legacy `_example` rows. Use `--allow-empty-context` only for intentional work without injected context. Manifests do not replace the human-readable execution plan. Workers report findings to the owner and do not commit or merge.

#### 1.4 Activate task `[required · once]`

Review artifacts against the user's request, then run `python3 .trellis/scripts/task.py start <task-dir>`. Existing authorization to implement is enough; do not insert a second approval gate. If the user asked to review a plan first, honor that boundary before starting implementation.

#### 1.5 Completion criteria

The scope and acceptance criteria are recorded, complex tasks have design and execution artifacts, material decisions are resolved, and the task is `in_progress`. Delegated work also has explicit file ownership and usable context. These conditions mark planning complete, not the whole task.

## Phase 2: Execute

#### 2.1 Implement `[required · repeatable]`

Read `trellis-before-dev`, task artifacts and applicable specs. Trace the relevant flow and callers before editing. Reuse existing capabilities; keep product-owned behavior in `seal-harness-desktop/`. Do not alter the read-only `deepseek-harness/` submodule. Preserve unrelated dirty paths.

Execute the next independently verifiable stage. The main session owns integration and authorized commits. Implement/research agents receive the task path and an exact write boundary; a worker completes its assigned unit directly.

#### 2.2 Quality check `[required · repeatable]`

Use `trellis-check` and the applicable spec's Quality Check section. Run existing commands for the affected scope from `.trellis/spec/general/desktop-build.md`; there is no universal root lint command. Choose a meaningful regression check for nontrivial behavior, without writing tests that merely restate the implementation.

Before a stage commit, inspect the whole stage diff, not only the most recent edit. Before final completion, verify cross-package contracts for every affected package. Builds and tests remain headless; launching the graphical app is explicit. Fix introduced failures and recheck. Report pre-existing or environment failures separately.

#### 2.3 Rollback `[on demand]`

If findings invalidate the plan, revise task artifacts before proceeding. Revert only the task's own changes after inspecting the diff; never discard unrelated work. Keep accepted stages as rollback points. Research unresolved facts rather than masking failures with defaults or silent catches.

## Phase 3: Finish

#### 3.2 Debug retrospective `[on demand]`

Use `trellis-break-loop` for repeated failures. Record the root cause, evidence, and smallest prevention that would catch it again. Avoid speculative checklists.

#### 3.3 Spec update `[required · once]`

Use `trellis-update-spec` to judge whether behavior, command contracts or durable lessons changed. Update the owning spec when needed; otherwise record that no spec change was necessary. Keep migration progress in task artifacts and the migration record rather than turning it into a permanent rule.

#### 3.4 Commit changes `[when authorized]`

Inspect `git status --short`, `git diff`, and recent commit style. Group task-owned paths into coherent, verified stages. Use explicit path staging, inspect `git diff --cached`, and commit within the user's authorization. Exclude unrecognized or unrelated changes. If committing was not requested, leave the result reviewable and report that it is uncommitted.

Do not repeat approval when stage commits are already authorized. Commit authorization does not authorize push or release. Keep submodule pin updates separate. Journal and archive helpers use their default automatic commits, limited to their own files.

#### 3.5 Wrap-up reminder

Use `trellis-finish-work` to report actual changes, checks, commits, failures and remaining work. Archive only when acceptance criteria pass, with `task.py archive <task>`. Leave incomplete tasks active. Record useful session progress with `add_session.py`.

## Workflow maintenance

Keep `## Phase Index`, `## Phase 1: Plan`, the `#### X.Y` step headings, and matching `[workflow-state:STATUS]` blocks. `.trellis/scripts/common/workflow_phase.py` reads the headings; `.codex/hooks/inject-workflow-state.py` reads the status blocks. After edits, run the context commands for every retained step and inspect hook output.

Lifecycle hooks can be configured in `.trellis/config.yaml` or task metadata under `hooks.after_create`, `after_start`, `after_finish`, and `after_archive`. `after_finish` only clears the current pointer; it does not prove completion. Do not add network, publication or commit side effects without corresponding authorization.

Trellis CLI source examples in bundled references refer to the Trellis project, not this repository. This checkout does not own Trellis's `packages/cli` template tree. Review local customizations when upgrading; `.trellis/.template-hashes.json` preserves copied template baselines only for existing files.
