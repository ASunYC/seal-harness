# cc-haha 功能插件化改造说明手册

> 目标：在 Seal Harness 现有导航结构下，通过一组产品插件装配，使安装后可获得 cc-haha 的全部功能。
> 形态决策：**产品插件**（`seal-harness-desktop/plugins/<name>/`）。
> 运行时决策：**混合**——Agent 核心复用 DSH，（Workflow / Agent Teams / 轨迹 / 宠物 / IM 等）独有能力自建 Host 服务。
> 推进节奏：**先补齐 DSH 已有能力**（低风险高产出），再做独有功能。
> 排除范围：技能、连接器（另一台机器上并行改造，本手册不涉及）。

---

## 一、先纠正一个前提

cc-haha 不是「一个待移植的应用」，它与 Seal Harness 的关系不是 fork 关系：

| 维度 | cc-haha | Seal Harness |
| --- | --- | --- |
| 运行时 | Bun（`Bun.serve`、sidecar） | Node 22/24 + Yarn 4 |
| Agent 内核 | 自研，Anthropic SDK 直连（`src/tools/`、`src/services/`） | DSH Cordis agent loop（`dsh-agent-loop`、`dsh-tools`） |
| 桌面壳 | Electron + 自建 IPC（118 个 channel）+ 自建 preload | Electron + DSH Desktop 插件化外壳 |
| UI | React + Vite + Zustand + Tailwind；**自有组件库与设计系统** | React 18.3.1 + DSH Client slot + DSH 原生设计 token |
| 扩展机制 | Claude Code plugin（`.claude-plugin/marketplace.json`） | Cordis 插件 / service / slot / bundle |

**结论：不存在「搬代码」这条路径。** `desktop/src/components/chat/` 单目录就有 51,272 行，且依赖 cc-haha 自有 token（`--color-surface`、`--radius-md`、`z-[var(--z-dropdown)]`）和自有 i18n（5 个 locale 文件）。这些代码进入 DSH 后必须整体重写。

**真正的杠杆在这里**：DSH 官方运行时已经内置了 cc-haha 的绝大多数能力包，共 309 个（`vendor/dsh-runtime/0.1.7-alpha.2/`）。其中 `dsh-workflow`、`dsh-experimental-agent-team`、`dsh-subagent`、`dsh-terminal`、`dsh-token-meter`、`dsh-computer-use`、`dsh-browser-use`、`dsh-schedule`、`dsh-permission-presets`、`dsh-mcp-client`、`dsh-session-query-sqlite`、`dsh-client-ui-workflow-run`、`dsh-experimental-client-ui-agent-team` 等**已在 Beta Desktop 依赖树中**，只是 profile 没有装配对应 bundle 或缺少 UI 装配点。

所以「摇身一变具备 cc-haha 全部功能」= **装配官方已有 bundle + 为缺失能力写产品插件**，而不是移植 5 万行 React。

---

## 二、能力映射表

这是本手册的核心。60 项能力逐一归类，`性质` 列决定工作量。

| cc-haha 功能 | 性质 | 落点 | cc-haha 参考文件 |
| --- | --- | --- | --- |
| 多会话工作台 | ✅ 原生 | `dsh-session` + `dsh-client-ui-sidebar`（已装配） | `components/layout/Sidebar.tsx` |
| 会话标签页 | ✅ 原生 | `dsh-client-ui-session` | `components/layout/TabBar.tsx` |
| 全局搜索 Cmd+K | ✅ 原生+UI | `dsh-tool-fs-search`；UI 走 `seal-harness-search` | `components/search/GlobalSearchModal.tsx` |
| 终端 | ✅ 官方包 | `dsh-terminal` + `dsh-client-ui-sidebar-terminal` | `pages/TerminalSettings.tsx` |
| 改动逐个文件审阅 / Diff | ✅ 官方包 | `dsh-workspace-changes` | `components/workspace/WorkspaceDiffSurface.tsx` |
| 内置浏览器预览 | ✅ 官方包 | `dsh-browser-use` + `dsh-experimental-browser-use-runtime` + `dsh-experimental-browser-use-stagehand-native` | `components/workbench/WorkspaceBrowser*` |
| 权限五档 | ✅ 官方包 | `dsh-permission-presets` + `dsh-client-ui-permission-presets` + `dsh-user-approval` | `components/controls/PermissionModeSelector.tsx` |
| 模型自选 / Provider 预设 | ✅ 官方包 | `dsh-client-ui-settings-models` + `dsh-llm-pi-ai`（品牌插件已扩展推理档位） | `pages/settings/ProviderSettings.tsx` |
| 本地端点（LM Studio / Ollama） | ✅ 官方包 | 同上，pi-ai provider | — |
| MCP 图形化管理 | ✅ 官方包 | `dsh-mcp-client` + `dsh-mcp-resources` | `pages/McpSettings.tsx` |
| 可视化 SubAgent 管理 | ✅ 官方包 | `dsh-subagent` + `dsh-subagent-in-process-driver` + `dsh-client-ui-subagent` + `dsh-client-ui-settings-subagent` | `components/settings/AgentManager.tsx` |
| Agent Teams 协作工作台 | ✅ 官方包 + **UI 自建** | `dsh-experimental-agent-team` + `dsh-experimental-tool-agent-team`（已装，无 UI）；UI 走 `seal-harness-agent-teams` | `components/agentTeams/`（5,695 行） |
| 动态 Workflow 编排 | ✅ 官方包 + **UI 自建** | `dsh-workflow` + `dsh-tool-workflow`（已装，无 UI）；UI 走 `seal-harness-workflow` | `stores/workflowStore.ts` |
| 定时任务 | ✅ 官方包 + **UI 自建** | `dsh-schedule` + `dsh-client-ui-schedule`；产品已有空态壳 | `pages/ScheduledTasks.tsx`、`components/tasks/`（1,865 行） |
| 会话活动面板 | ✅ 原生 + UI | `dsh-jobs` / `dsh-tool-jobs`；UI 走 `seal-harness-activity` | `components/activity/`（2,081 行） |
| 模型请求追踪 | ✅ 官方包 + UI | `dsh-session-telemetry` + `dsh-client-ui-trajectory`；UI 走 `seal-harness-trajectory` | `components/trajectory/`（2,014 行） |
| 用量统计 | ✅ 官方包 + UI | `dsh-token-meter` + `dsh-session-stats`；UI 走 `seal-harness-usage` | `pages/ActivitySettings.tsx` |
| 语音输入 | ✅ 官方包 | `dsh-experimental-voice-input-bundle` + `dsh-experimental-speech-to-text` | `features/voiceInput/` |
| 侧边提问 SideChat | ✅ 官方包 | `dsh-tool-ask-user` + `dsh-client-ui-user-questions` | `components/sideChat/` |
| 计划模式 | ✅ 官方包 | `dsh-plan-mode` + `dsh-client-ui-plan` | — |
| 记忆系统 | ✅ 官方包 | `dsh-session-reference` + `dsh-context` 系 | `pages/MemorySettings.tsx` |
| 会话内查找 | ✅ 官方包 | `dsh-client-ui-conversation` find 系 | `components/search/FindInPageModal.tsx` |
| 诊断 / Doctor | ✅ 官方包 | `dsh-experimental-inspector` + `dsh-host-plugin-inventory` | `components/doctor/`、`pages/DiagnosticsSettings.tsx` |
| 图片来源追加 | ✅ 官方包 | `dsh-attachment` + `dsh-client-ui-attachment` | `components/chat/AssistantMessage.images` |
| 渲染产物 / Deliverables | ✅ 官方包 | `dsh-client-ui-deliverables` | `components/chat/AssistantOutputTargetCard.tsx` |
| 压缩 / 上下文管理 | ✅ 官方包 | `dsh-compaction` + `dsh-command-compact` | — |
| 主题多套 | ⚠️ 改造 | 产品已有浅/深色；cc-haha 是 6 套（纯白/纸墨/经典暖色/青瓷/墨夜/墨夜蓝） | `theme/`、`globals.test.ts` |
| Computer Use | 🔨 自建 Host | `dsh-computer-use` + `dsh-experimental-computer-use-cua-driver-native` + Python helper 移植 | `components/computer-use/`、`runtime/*.py` |
| 分支 / Worktree 启动 | 🔨 自建 Host | 无官方对应；需 Host 服务做 git 操作 | `components/layout/NewSessionStarter.tsx` |
| 图片生成 | 🔨 自建 Host | 无官方对应；走 credentials + provider | `pages/settings/ProviderSettings.tsx` |
| 桌面宠物 | 🔨 自建 Host + native | 完全无官方对应；需 Electron 独立窗口 + `BrowserWindow` 透明层 | `features/pets/`、`electron/services/petWindow.ts` |
| H5 远程访问（扫码） | 🔨 自建 Host | 无官方对应；需 WS carrier 暴露 + QR | `pages/RemoteAccess.tsx`、`pages/settings/H5AccessSettings.tsx` |
| IM 接入 8 平台 | 🔨 自建 Host | 无官方对应；`adapters/` 8 个平台是最大单体 | `adapters/{telegram,feishu,wechat,dingtalk,whatsapp,...}` |
| Claude/ChatGPT/Grok 官方账号登录 | 🔨 自建 Host | OAuth 流程独有 | 3 个 OAuth store + 3 个 login 组件 |
| 数据迁移（从 ~/.claude） | 🔨 自建 Host | `electron/services/dataMigration*` | `pages/settings/DataMigrationSettings.tsx` |
| 公开访问（Public Access） | 🔨 自建 Host | `electron/services/publicAccess.ts` | `pages/settings/PublicAccessSettings.tsx` |
| 更新检查 | ❌ 不做 | 产品更新通道明确关闭 | `components/layout/UpdateChecker.tsx` |
| 技能市场 | ❌ 排除 | 按用户指示不涉及 | `pages/ExtensionMarket.tsx` |

**统计**：约 25 项（42%）是纯装配工作，0 行 UI 代码；约 6 项是「官方能力已在、缺 UI」；约 12 项需要自建 Host 服务。

---

## 二之二、实测修正（2026-10-09）

初版的「性质」列是按 vendored 目录**存在**推断的。实测 `dsh-base` 与 `dsh-web-app` 的真实装配清单后，结论必须修正：官方装配的范围远比初版估算的大。

### 装配机制（实测）

```
bundle 层（dsh.profile.bundles 顺序）
  ① @deepseek-ai/dsh-base     → cordis.patch.yml（92 行 insert，Host 能力底座）
  ② @deepseek-ai/dsh-web-app  → cordis.patch.yml（81 行 insert，浏览器界面名册）
↓
profile 用户层  <profileDir>/cordis.patch.yml
↓
overlay 层
  · dsh-plugin-desktop-beta 的 cordis.patch.yml（Desktop 外壳）
  · seal-harness-desktop 的 cordis.patch.yml（产品插件，最后应用、优先级最高）
```

- 活动 profile 模板固定为 `web = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`；产品不自建模板。
- 后续层按 `id` 覆盖前层整行 `config`，可用 `insert` 追加新行。产品 overlay 可以 insert 官方包。
- 依赖解析：根 `package.json` 的 `resolutions`（1148 条）把 `@deepseek-ai/dsh-*` 重定向到 `file:vendor/dsh-runtime/0.1.7-alpha.2/<tarball>`，因此 vendored 包均可解析，无需新增网络依赖。Loader 在「Desktop 安装图」与「活动 Profile」之间择优，找不到则跳过。

### 真实分层：25 / 6 / 9 / 0

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| **已装配** | 25 | 官方 patch 已 insert，无需改动，只需实测可用性 |
| **已安装未装配** | 6 | 包在依赖图中，缺 profile 行 |
| **可添加** | 9 | 需先在 `dsh-plugin-desktop-beta` 补依赖声明 |
| **不可用** | 0 | 无缺失项 |

**已装配（25）**：Deliverables UI、Jobs UI/Host/工具、权限档位 UI/Host、Plan UI/模式、定时任务 UI、SubAgent UI/Host/设置UI、BrowserUse 侧栏、终端 UI、轨迹 UI、用户提问 UI、工作流 UI/工具、上下文压缩、MCP 资源、会话查询、会话引用、会话统计、Token 计量、工作区变更。

**关键警号：「已装配」不等于「可用」**，存在三类折扣，必须逐项实测：

1. **配置级关闭** — `session-query-sqlite` 在 `dsh-web-app` 里配 `path: ':memory:'` + `openAt: never`（注释明确写全文搜索是 opt-in）。全局搜索需在更高层覆盖为 `openAt: first-search`。
2. **Host 已在、入口未见** — 工作流 Host 与 UI 均已装配，但产品当前一级导航只有首页/问问决策/空间/定时任务；实际入口待确认。
3. **需模型工具驱动** — Workflow、Agent Teams 依赖模型主动调用工具，静态装配不产生可见界面。

**已安装未装配（6，成本最低）**：`dsh-terminal`（终端 Host，UI 已在）、`dsh-mcp-client`（MCP Host，资源已在）、`dsh-workflow`（工作流 Host，工具与 UI 已在）、`dsh-experimental-agent-team`（AgentTeams Host，缺工具与 UI）、`dsh-tool-ask-user`（提问工具，UI 已在）、`dsh-experimental-speech-to-text`（STT，建议改用整包 bundle）。

**可添加（9）**：`dsh-experimental-agent-team-profile`、`dsh-experimental-voice-input-bundle`、`dsh-browser-use`、`dsh-experimental-browser-use-runtime`、`dsh-computer-use`、`dsh-experimental-computer-use-cua-driver-native`、`dsh-schedule`、`dsh-experimental-client-ui-agent-team`、`dsh-experimental-tool-agent-team`。

**现成成套开关**：官方 `OPTIONAL_BUNDLES` 只有两个，各自自带完整 `cordis.patch.yml`，是「一次启用一组成套能力」的最短路径：

| bundle | 一次装齐 |
| --- | --- |
| `dsh-experimental-agent-team-profile` | `dsh-experimental-agent-team` + `dsh-experimental-tool-agent-team` + `dsh-experimental-client-ui-agent-team`（Host + 工具 + UI 三件套） |
| `dsh-experimental-voice-input-bundle` | `speech-to-text` + `speech-to-text-sensevoice` + `api-speech-to-text` + `client-ui-voice-input` |

因此 **Agent Teams 的 UI 不需要自建** —— 初版手册按「UI 自建 / 参考 5,695 行」估算是错的，官方已提供 `dsh-experimental-client-ui-agent-team`。

---

## 三、插件拆分方案

按你说的「从界面布局入手」，同时对齐 DSH 的 slot 拓扑。每个插件对应**一个界面区域 + 一个能力域**，边界与 `AGENTS.md` 的「最小必要修改」一致。

### 3.1 装配类（第一批，只改 profile）

不新建插件，只扩展 `dsh-plugin-desktop-beta/cordis.patch.yml` 与 `seal-harness-desktop/cordis.patch.yml`，把已装未启的 bundle 打开：

```
终端            dsh-client-ui-sidebar-terminal
Diff / 工作区改动 dsh-workspace-changes
SubAgent        dsh-client-ui-subagent + dsh-client-ui-settings-subagent
权限档位         dsh-client-ui-permission-presets
Browser Use     dsh-experimental-browser-use-runtime（+ stagehand-native）
Workflow 运行时  dsh-tool-workflow（Host 侧，UI 见下批）
Agent Teams     dsh-experimental-tool-agent-team（Host 侧，UI 见下批）
语音输入         dsh-experimental-voice-input-bundle
Plan 模式        dsh-client-ui-plan
会话引用/记忆     dsh-session-reference
Deliverables    dsh-client-ui-deliverables
Jobs/活动        dsh-tool-jobs（Host 侧）
```

**这一批的验收**：`corepack yarn seal-harness:build && corepack yarn seal-harness:check` 通过，且 `verify-profile-boot.mjs` 报告全部条目激活。不需要写任何 UI 代码，用户已经能感知「多出一批功能」。

### 3.2 新增产品插件（第二批，官方能力 + 自建 UI）

每个插件遵循仓库既有四层结构。命名沿用 `@seal-harness/<name>`。

| 插件 | 界面区域 | Host 侧 | Client 侧 | 消费的官方能力 |
| --- | --- | --- | --- | --- |
| `workflow` | 一级页面 + 会话内阶段视图 | `dsh-workflow` 编排运行时 | 阶段视图、中断、断点续跑 | `dsh-tool-workflow`、`dsh-client-ui-workflow-run` |
| `agent-teams` | 独立工作台 | `dsh-experimental-agent-team` | 成员泳道、任务、通信流、依赖图 | `dsh-experimental-tool-agent-team`、`dsh-experimental-client-ui-agent-team` |
| `schedules` | 一级页面（已有空态壳） | `dsh-schedule` | 创建任务、执行记录、周期编辑 | `dsh-client-ui-schedule` |
| `activity` | 会话右侧面板 | `dsh-jobs` | 任务进度、后台任务、SubAgent 来源 | `dsh-tool-jobs` |
| `trajectory` | 独立视图或右侧面板 | `dsh-session-telemetry` | 请求表、时延、最小地图、筛选 | `dsh-client-ui-trajectory` |
| `usage` | 设置页或独立面板 | `dsh-token-meter` + `dsh-session-stats` | Token 趋势图 | `dsh-session-query-sqlite` |
| `search` | 全局浮层（Cmd+K） | — | 跨会话全文搜索 + 跳转命中 | `dsh-tool-fs-search`、`dsh-session-query` |
| `diff-review` | 右侧工作区 | `dsh-workspace-changes` | 逐文件 Diff、语法高亮、整轮撤销 | 官方 + 高亮 worker 重写 |

### 3.3 独有能力插件（第三批，需自建 Host 服务）

| 插件 | 自建内容 | 依赖的外部运行时 | 风险 |
| --- | --- | --- | --- |
| `computer-use` | Host 服务 + Python helper 桥接 | `dsh-computer-use` + `cua-driver-native` | 中：三平台 helper 分别验证 |
| `git-worktree` | git 操作 Host 服务（分支列表、worktree 创建） | 无 | 低 |
| `image-generation` | provider 扩展 + credentials | 无 | 低 |
| `official-login` | Claude/ChatGPT/Grok OAuth 服务 | 无 | 中：OAuth 回调需 Electron |
| `pets` | Electron 独立透明窗口 + sprite 引擎 | 无官方对应 | 高：两个新 preload + 窗口生命周期 |
| `h5-remote` | WS carrier 暴露 + QR + 锁屏保活 | 无官方对应 | 高：涉及安全边界 |
| `im-adapters` | 8 平台适配器（建议拆 8 个子包） | 无官方对应 | 高：最大单体 |
| `public-access` | 公网暴露 + 凭据管理 | 无官方对应 | 高：安全边界 |

### 3.4 插件依赖图

```
local-data ──▶ identity ──▶ user
                  │
                  ▼
             navigation ◀── (每个 UI 插件注册入口)
                  ▲
                  │
   ┌──────────────┼──────────────┬──────────────┐
   │              │              │              │
workflow    agent-teams      schedules      activity
   │              │              │              │
   └──────────────┴──────────────┴──────────────┘
                  │
        trajectory / usage / search / diff-review
                  │
   computer-use / git-worktree / image-generation
   official-login / pets / h5-remote / im-adapters
```

`navigation` 提供 `sealHarnessNavigation` 注册服务，UI 插件通过它注册一级页面或首页入口。这条链已经在跑，新插件直接复用。

---

## 四、插件四层模板

照抄这个结构，不要自创。以 `workflow` 为例：

```
seal-harness-desktop/plugins/workflow/
├── package.json          # name: @seal-harness/workflow, dsh.client.inject, peerDependencies
├── src/
│   ├── index.js          # Host 入口：inject 声明 + apply()
│   ├── module.js         # 业务逻辑 + hostHandlers（RPC 动作表）
│   ├── client.jsx         # Client 入口：inject + apply() + 注册面板
│   ├── panel.jsx          # React 面板
│   ├── styles.js          # 样式字符串（注入 <style>）
│   └── runtime.js         # 可选：独立子入口（仅 experts 有此先例）
├── tests/
│   ├── host.test.mjs
│   └── client.test.mjs
└── README.md
```

### 4.1 Host 入口

```js
// src/index.js
import { mountCapability } from '../../capability-shared/src/host.js'
import { createModule } from './module.js'

export const name = 'seal-harness-workflow'
export const inject = ['connection', 'tools', 'sealHarnessIdentity', 'sealHarnessDatabase', 'workflow']

export async function apply(ctx) {
  await mountCapability(ctx, 'workflow', createModule)
}
```

`mountCapability` 会：解析 `DSH_HOME`（默认 `~/.seal-harness`）、构造 backend、为 `module.handlers` 的每个动作注册 `/api/seal-harness-capabilities/workflow/<action>` RPC 端点、并把实例暴露为 `ctx.sealHarnessWorkflow`。**不要重写这套。**

### 4.2 Client 入口

```jsx
// src/client.jsx
import { capabilityApi, registerPanel } from '../../capability-shared/src/client.jsx'
import { WorkflowPanel } from './panel.jsx'

export const inject = ['slots', 'connection', 'layout', 'sealHarnessNavigation']

export function apply(ctx) {
  const api = capabilityApi(ctx)
  function Panel() { return <WorkflowPanel api={api} /> }
  registerPanel(ctx, { id: 'workflow', label: '工作流', order: 40, icon: 'workflow', description: '编排并运行多阶段子代理' }, Panel)
}
```

`registerPanel` 会注入样式并把面板注册进导航服务；`ctx.effect()` 保证插件卸载时自动撤销。左侧菜单结构由你现有导航决定，插件只声明 `order` 与 `label`。

### 4.3 package.json

```json
{
  "name": "@seal-harness/workflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Seal Harness 工作流编排",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-connection",
        "@seal-harness/navigation"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@seal-harness/navigation": "0.1.0",
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "0.1.7-alpha.2",
    "@deepseek-ai/dsh-workflow": "0.1.7-alpha.2",
    "react": "18.3.1"
  }
}
```

### 4.4 注册进构建（两处，缺一不可）

```js
// seal-harness-desktop/scripts/build.mjs:14
export const productPlugins = [
  'local-data', 'identity', 'user', 'navigation',
  ...capabilityPlugins,                    // store/connectors/skills/experts — 本次不动
  'session-context-selector',
  'workflow', 'agent-teams', 'schedules', 'activity',   // ← 新增
]
```

```yaml
# seal-harness-desktop/cordis.patch.yml
- insert:
    - id: seal-harness-workflow
      name: '@seal-harness/workflow'
```

### 4.5 模型工具（可选）

需要让模型主动调用时，用官方 `defineTool`，参照 `plugins/skills/src/create-tool.js`：

```js
ctx.effect(() => registerWorkflowCreationTool(ctx, workflow), 'seal-harness-workflow: creation tool')
```

---

## 五、阶段计划

### 阶段 0：装配清单核对（无代码）

产出 `docs/seal-harness/cc-haha-capability-matrix.md`，把第二节的表逐条核对到**实际已安装包导出**，而不是 vendored 目录清单。理由：`dsh-plugin-desktop-beta/package.json` 声明了 165 个依赖，但 vendored 目录有 309 个包 —— 声明 ≠ 可用。每条标注四态：`已装配` / `已安装未装配` / `需安装` / `需自建`。

**完成标志**：矩阵中每一项都有明确归属与验证方式。

### 阶段 1：官方 bundle 装配（低风险高产出）

按 3.1 补 `cordis.patch.yml`。每补一项跑一次 `seal-harness:build` + `seal-harness:check`，并在真实 Electron 窗口确认。**分批提交**，每批一个 commit，便于定位是哪一项引起冲突。

**完成标志**：终端、Diff、SubAgent、权限档位、Browser Use、Plan 模式、语音输入、Deliverables 在真实窗口可用；`check:desktop-variants` 通过。

### 阶段 2：官方能力 + 自建 UI

按 3.2 顺序做：`schedules`（壳已在）→ `activity` → `trajectory` → `usage` → `workflow` → `agent-teams` → `search` → `diff-review`。

`schedules` 放第一是因为空态壳（`navigation/src/client.jsx` 的 `SchedulesPanel`、`TasksMenu`）已经存在，改造成本最低，能最快打通「新插件全链路」的验证。

**完成标志**：每个插件有 host/client 测试、在真实窗口验收、Profile 激活数正确。

### 阶段 3：独有能力

按 3.3 顺序：`git-worktree` → `image-generation` → `official-login` → `computer-use` → `pets` → `h5-remote` → `public-access` → `im-adapters`。

顺序按「依赖复杂度 × 安全边界」排：先做无外部运行时、无安全边界的，把有安全影响的（H5、公网、IM）放最后，因为它们需要单独的安全评审。

**完成标志**：每项在 Windows 实测；macOS/Linux 的分别记录，不推断。

### 阶段 4：收口

- 移除 `navigation` 里 `spaces` / `schedules` 的空态（改为真实实现）
- 更新 `seal-harness-desktop/README.md` 与 `docs/seal-harness/validation.md`
- 补 `THIRD_PARTY_NOTICES.md`（cc-haha 是 MIT，若复用其代码或 Python helper 必须署名）

---

## 六、硬约束与陷阱

这几条是本仓库规则与实测踩坑的结合，违背任何一条都会返工。

**仓库规则**

1. `deepseek-harness/` 是只读子模块。任何改动都要通过产品插件或官方公开扩展点。
2. `seal-harness-desktop/` 不是 Yarn workspace，不创建第二份锁文件。复用 `dsh-plugin-desktop-beta/node_modules`（通过 `linkProductDependencies()` 的 junction）。
3. 共享 Desktop 行为必须 **Beta 先行**，改完同步 `dsh-plugin-desktop/` 并跑 `corepack yarn check:desktop-variants`。
4. 版本号只递增补丁位。
5. 提交、推送、发布分别按授权执行。提交授权不含推送。

**技术陷阱**

6. **不要把 cc-haha 的代码直接拷进来。** 它的 Tailwind token（`--color-surface`）、圆角（`rounded-md`）、层级（`z-[var(--z-dropdown)]`）、i18n、组件库与 DSH 完全不兼容。UI 参考其交互与信息架构，代码重写。
7. **不要绕过 `capability-shared`。** 每个插件自己写 RPC 注册、样式注入、导航注册会立刻产生不一致；`mountCapability` / `registerPanel` / `capabilityApi` / `leaveResource` 就是为此存在的。
8. **`ctx.effect()` 是唯一正确的清理方式。** 插件卸载、generation 切换时，样式、slot 注册、订阅、子进程都必须通过它撤回。`navigation/src/client.jsx` 里 `releases.forEach(r => r?.())` 是标准写法。
9. **官方包「声明了」不等于「可用」。** 阶段 0 必须核对真实导出。`dsh-experimental-client-ui-agent-team` 与 `dsh-experimental-tool-agent-team` 是不同包——前者是 UI，后者是工具，只装一个会出现「有工具没界面」或反之。
10. **`verify-profile-boot.mjs` 会拒绝未激活条目。** 补 bundle 后若报 `entries did not activate`，通常是 peerDependencies 版本不匹配或 inject 声明了未注册的服务。
11. **宠物窗口需要新的 preload。** cc-haha 有 `pet-preload.ts` 和独立 `petWindow.ts` 服务；DSH Desktop 的 BrowserWindow 由 `ElectronShellGeneration` 独占，宠物窗口必须走同一 generation 的生命周期，不能自己 `new BrowserWindow()`。
12. **H5 / 公网访问涉及安全边界。** cc-haha 有 `h5AccessPolicy.ts`、`localAccessAuth.ts`、`petAccessPolicy.ts` 三处策略。移植前需要单独设计，不能直接放开 loopback 绑定。
13. **Computer Use 的授权边界已在 cc-haha AGENTS.md 固化：设定页开启 + 确认弹窗 = 授权全部应用。** 若沿用这个模型，不要自创 per-app allowlist。
14. **测试要求**：`src/`/`desktop/src/`/`adapters/` 下可执行的生产代码改动需要同区域回归测试（cc-haha 规则；Seal Harness 用 `tests/*.test.mjs` + `seal-harness:check`）。新产品插件的 `tests/` 目录照 `plugins/skills/tests/` 写。

---

## 七、验收标准

每个插件必须独立满足，缺一项不得报通过：

- [ ] `corepack yarn seal-harness:build` 通过
- [ ] `corepack yarn seal-harness:check` 通过，Profile 激活条目数符合预期
- [ ] `corepack yarn check:layout` 通过（涉及布局时）
- [ ] `tests/host.test.mjs` + `tests/client.test.mjs` 覆盖：正常路径、空态、错误态、插件卸载后清理
- [ ] 真实 Electron 窗口（隔离 `DSH_HOME`）实测该界面区域
- [ ] 插件禁用/卸载后不残留样式、slot、订阅、进程
- [ ] `docs/seal-harness/validation.md` 追加本轮实测结果，明确区分「未执行」

**不得替代验收的证据**：单元测试不等于视觉验收；headless build 不等于原生安装；Windows 通过不等于 macOS/Linux 通过；mock 不等于真实模型回复。

---

## 八、立即可启动的第一步

阶段 0 与阶段 1 可以现在就做，不需要任何新代码：

1. 建 `.trellis/tasks/<date>-cc-haha-capability-matrix/`，把第二节的表变成任务 PRD
2. 逐项核对 `dsh-plugin-desktop-beta/package.json` 的 165 个依赖，填「四态」判定
3. 按 3.1 分批补 `cordis.patch.yml`，每批一个 commit
4. 每批跑 `seal-harness:build` + `seal-harness:check` + 真实窗口

做完阶段 1，你会先看到终端、Diff 审阅、SubAgent 管理、权限档位、内置浏览器、Plan 模式、语音输入、Deliverables 这批功能出现——这是在写第一行 UI 代码之前就能拿到的产出。

---

## 附：文件索引

| 用途 | 路径 |
| --- | --- |
| 插件构建入口 | `seal-harness-desktop/scripts/build.mjs` |
| 产品 Profile 组合 | `seal-harness-desktop/cordis.patch.yml` |
| Desktop Profile 组合 | `dsh-plugin-desktop-beta/cordis.patch.yml` |
| 共享 Host 装载器 | `seal-harness-desktop/plugins/capability-shared/src/host.js` |
| 共享 Client 装载器 | `seal-harness-desktop/plugins/capability-shared/src/client.jsx` |
| 导航服务 | `seal-harness-desktop/plugins/navigation/src/{client.jsx,model.js}` |
| 模型工具范例 | `seal-harness-desktop/plugins/skills/src/create-tool.js` |
| 插件测试范例 | `seal-harness-desktop/plugins/skills/tests/` |
| 桌面构建契约 | `.trellis/spec/general/desktop-build.md` |
| 工程规范 | `.trellis/spec/general/engineering-principles.md` |
| 官方 DSH 包清单 | `vendor/dsh-runtime/0.1.7-alpha.2/` |
| cc-haha 功能清单 | `D:/git-workspace/AI/cc-haha/README.md` |
| cc-haha 桌面结构 | `D:/git-workspace/AI/cc-haha/docs/internals/structure.md` |
