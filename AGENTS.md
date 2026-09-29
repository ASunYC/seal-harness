# Seal Harness下游工程规则

## 版本号与发布

- 普通迭代默认仅递增补丁版本号 `x.y.z` 的 `z`，没有明确同意时不得升级中间版本或主版本。
- 升级中间版本或主版本前，须向用户说明影响并取得明确同意，然后才能修改 manifest、发布工作流默认值、发布说明、Git 标签或 GitHub Release。
- 预发布版本沿用已确认的基础版本号。创建版本提交、标签或 Release 前，再核对仓库内所有版本字段一致。

本仓库是 DSH Desktop 的直接下游 checkout。以下Seal Harness规则优先于本文件后半部分保留的上游规则；上游规则仍适用于相应的上游目录。用户本次明确的范围、授权和禁止事项优先，不因工作流重复请求已获得的授权。

- 尽量不修改继承的上游实现。优先使用公开的插件服务、事件、slot、bundle 和 profile；只有确认公开扩展无法满足当前需求时，才记录缺口并做最小必要修改。
- `seal-harness-desktop/` 放Seal Harness产品身份、图标、产品组合、品牌插件和启动/打包接入。产品插件先在此目录实现，出现真实独立、可复用功能后才加入根 `packages/`，不预建空包。
- `deepseek-harness/` 保持只读的固定提交子模块。更新 pin 单独提交，不与产品行为混合。
- 根 `dsh-plugin-desktop/`、`dsh-plugin-desktop-beta/`、`dsh-desktop-next/` 等是继承的上游包。必须修改共享 Desktop 行为时，遵守下方 Beta 先行和双变体检查规则；Seal Harness专属代码不镜像到这些目录。
- 根 Yarn `4.18.0` 与 Node `^22.19.0 || >=24.0.0` 保持不变。`seal-harness-desktop/` 是产品自有包，不并入根 Yarn workspaces；复用已安装的 Desktop 工具和上游构建链，不复制运行时、不另建包装仓库或第二套锁文件。
- 产品名为Seal Harness，应用 ID 为 `com.seal-harness.desktop`，默认数据目录为 `~/.seal-harness`；显式 `DSH_HOME` 覆盖应保留。名称、安装器、图标、数据目录和更新渠道必须一致，不能接受社区 DSH Desktop 的产品更新。
- 保留第三方许可证、来源和 attribution。图标迁移核对 Git LFS、原始文件及来源哈希；构建产物不作为源文件提交。
- Windows、macOS、Linux 都是目标平台。构建、签名、安装、启动和升级分别记录实测结果，本机通过不代表跨平台通过。
- 按独立可验证阶段提交，只纳入本任务路径，保留已有未提交修改。提交、推送和发布遵循用户授权；提交授权不包含推送。
- 迁移范围和实际命令见 [迁移记录](docs/seal-harness/migration.md) 与 [桌面构建契约](.trellis/spec/general/desktop-build.md)。旧 wrapper 和补丁流程不再作为本仓库操作入口。

## 团队 Trellis 要求

- 所有协作者及其 AI 助手都应使用本仓库的 Trellis 工作流。开始工作时阅读 `.trellis/workflow.md`；实现或修改前必须阅读并遵守 `.trellis/spec/general/engineering-principles.md`，再按 `.trellis/spec/general/index.md` 加载本次涉及的工程契约。不能只读索引或以个人默认习惯替代项目规范；完成前按相关规范检查实际改动。
- 每个新开发会话先运行 `trellis --version` 检查 CLI。若命令不存在，先告知开发者正在安装，然后自动执行 `npm install -g @mindfoldhq/trellis@latest`，无需再次询问是否安装；安装后重新运行 `trellis --version` 验证。若安装因网络、权限或缺少 Node/npm 失败，明确报告原因和可执行的修复步骤，不声称安装成功，不擅自使用 `sudo`。若命令存在但执行失败，报告实际错误，不直接断言未安装。缺少 CLI 不免除阅读和遵守仓库规范的要求，已有本地 Python 脚本仍可使用。
- 本仓库已初始化 Trellis，新同事无需重新运行 `trellis init`。运行 `python3 .trellis/scripts/get_context.py` 查看上下文；仅在缺少开发者身份时运行 `python3 .trellis/scripts/init_developer.py <name>`。CLI 版本和 `.trellis/.version` 记录的项目模板版本分别看待；升级项目模板前检查本地定制，不能因版本提示直接覆盖。
- 不重复请求已获得的授权。明确的实施请求覆盖任务创建、必要规划和进入实现；只在需求确有歧义、超出范围或用户明确要求先审方案时提问。提交、推送和发布仍按用户授权分别处理。
- 即使所用 AI 工具未启用 Trellis hooks 或技能，也必须手动执行上述步骤。使用其他工具时，应确认其项目指令入口会读取本文件。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the desktop development workflow with `corepack yarn dev`.
- Build the desktop package with `corepack yarn build`.
- Before each release, run `corepack yarn aa:prepare-release` to build the latest official Agents Anywhere `main` for both Desktop channels. Commit the resulting artifact, provenance, manifests, and lockfile before packaging. Signed macOS releases and root Windows distribution commands verify freshness and installed versions; `DSH_AA_SOURCE_REF=pinned` is no longer supported.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- `corepack yarn dev:next` explicitly launches the experimental Next app; `corepack yarn check:next` validates it without a graphical application. Next uses the official published Web frontend and the recorded upstream Desktop presentation, with product capabilities composed as a separate bundle.
- Develop and validate Desktop feature changes in `dsh-plugin-desktop-beta/` first, then synchronize shared changes into `dsh-plugin-desktop/` while preserving declared variant differences. Before committing or pushing shared Desktop changes, run `corepack yarn check:desktop-variants` and validate both affected packages; neither package automatically inherits the other's source edits.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-desktop-next/` owns the separate experimental Desktop shell, Profiles and recovery, and adapters for the existing AA bridge and Community Market. Next-only changes do not belong in the Stable/Beta variant mirror. Keep its upstream reference and published runtime versions aligned; do not fork the official main frontend.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).
