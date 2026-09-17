# Seal Harness

<p align="center">
  <img src="assets/brand/seal-harness-mascot.png" width="180" alt="Seal Harness mascot">
</p>

Seal Harness 是一个面向 Node.js/TypeScript 的轻量 Agent Harness。它以
“能力皆插件”为设计原则，Seal 产品使用 Pi Agent 作为唯一 Agent 执行内核。

需要复用 DeepSeek Harness 插件时，可使用内置的 `seal-harness plugin` 管理器按需安装；
第三方插件与素材保存在隔离 Profile，不进入默认安装包。兼容边界见
[`docs/dsh-compatibility.md`](docs/dsh-compatibility.md)。

当前已经具备可运行的 Headless Agent 主链路：

- 零运行时依赖的插件微内核；
- 原生 ESM Profile；
- `@earendil-works/pi-agent-core` Runtime；
- 可选择加载的 Pi AI Provider；
- 可配置 OpenAI/Anthropic-compatible Provider，并从远端目录探测后立即调用模型；
- 可持久发现、后台执行和父级隔离的子 Agent；
- Worker 隔离的 JavaScript Workflow，可用并行与流水线批量编排子 Agent；
- 提供方无关的 Webhook 规则运行时与可选 GitHub HMAC 签名入口；
- 可配置的 stdio Language Server 导航，支持定义、引用、实现和 hover；
- 可替换的 Web 搜索/抓取 provider，默认公共 HTTP 抓取带 SSRF 与重定向防护；
- Session 持久的一次性、绝对时间与固定频率提醒，可在服务重启后恢复；
- Session 归属的后台 Job 注册、输出读取、等待与取消；
- 基于真实 PTY 的持久终端、增量输出和交互输入；
- JSONL/Memory Session；
- Session resume/fork、事务尾行恢复和中断工具的非重放恢复；
- 可重放的 LLM 摘要 Compaction，并在 Provider 故障时回退到确定性滑动窗口；
- 内容寻址附件（Session 存引用、请求时解析）；
- 强制 Policy/Approval 的工具执行管线；
- 防路径和符号链接逃逸的工作区工具；
- 分层 `AGENTS.md` 上下文；
- Headless CLI；
- 拥有 RPC 子进程生命周期、可复用 Session 和流式通知的 TypeScript SDK；
- 纯标准库 Python SDK，提供同等的同步运行、Session、独立通知订阅和有界进程回收；
- 基于官方 `@agentclientprotocol/sdk` 的 ACP stdio Server；
- Local-first WebUI、流式 HTTP Host 和浏览器审批；
- Host 持久化工作区注册、侧栏 Session 分组以及不触碰用户文件的安全移除；
- DSH 风格的 Settings 产品壳层，包含 General、Models 与 Plugins 管理页面，Models
  会按当前 Profile 动态发现 Provider，并显示模型容量与能力；
- 统一 `seal-harness run|headless|web` 产品启动器。

可选生态插件包括 Filesystem Skills、MCP Client、SQLite Session 和 JSONL RPC；它们
不属于微内核，也可以从 Profile 完全移除。

项目仍处于早期开发阶段，进程级沙箱和更完整的 SDK/协议层
正在按 [`docs/development-plan.md`](docs/development-plan.md) 实施。

## 环境

- Node.js 22.19 或更高版本
- pnpm 11

Pi 当前也要求 Node.js 22.19 以上。低版本 Node 可能在启动测试工具之前就失败。

## 下载即用

### 桌面窗口版（本地候选，尚未正式发布）

新增 Electron 桌面壳，继续使用 Seal 的 Web 界面和 PI 后台，不需要自己打开浏览器、
启动服务或粘贴 token。Windows 支持便携单文件 `.exe` 和 NSIS 安装版；
Linux 配置了 AppImage 构建目标，尚待 Linux 实机验证。

开发时执行 `pnpm desktop:dev` 打开桌面窗口；执行 `pnpm desktop:dist` 构建当前平台产物。
用户数据默认保存在用户目录下的 `.seal-harness`，不写入便携程序的临时解包目录。
详细启动、数据、构建与验收边界见 [桌面版说明](docs/desktop.md)。

### 原有 Web / CLI 压缩包

普通用户可从 [GitHub Releases](https://github.com/ASunYC/seal-harness/releases) 下载对应系统
的自包含压缩包。发行包已内置 Node.js 和生产依赖，解压后直接运行：

```text
# Windows
双击 Start Seal Harness.cmd

# Windows 终端方式（继续保留）
seal-harness.cmd web

# Linux / macOS
./seal-harness web
```

每个 Release 提供 Windows x64、Linux x64、macOS arm64、macOS x64 和
`SHA256SUMS.txt`。源码环境仅用于开发插件或参与贡献。

## 从源码运行

```sh
corepack enable
pnpm install
pnpm check
pnpm build
```

配置 Provider API key，例如：

```sh
export DEEPSEEK_API_KEY=...
```

运行：

```sh
pnpm seal-harness -- --provider deepseek --model deepseek-chat "检查这个仓库"
```

启动本地 WebUI（默认 `http://127.0.0.1:3080` 并打开浏览器）：

```sh
pnpm seal-harness -- web
```

WebUI 支持工作区、Provider/模型、Session 恢复、流式事件、工具卡片、中止和浏览器
审批。Models 设置可填写自定义 Provider ID、Base URL、协议和 API key，从 `/models`
探测目录并在当前进程中立即使用。内置 Provider 的 API key 写入工作区本机凭据文件，
启动环境中的密钥保持只读；动态发现的自定义 Provider 密钥只保存在当前 Node 进程。
两者都不会写入 Session。

附件可重复指定；显式使用该参数意味着文件内容会进入模型请求：

```sh
pnpm seal-harness -- --attach ./error.log --attach ./screenshot.png "分析附件"
```

如果省略 `--model`，CLI 使用该 Provider 目录中的第一个模型。Session 默认保存在
当前工作区的 `.seal-harness/sessions`。

常用安全选项：

```sh
# 完全不注册 shell 工具
pnpm seal-harness -- --no-shell "只分析代码"

# 非交互环境明确拒绝所有 ask 决策
pnpm seal-harness -- --deny-approvals "检查并修复问题"
```

`--yes` 会允许所有 `ask` 决策，只应在隔离环境中明确使用。

## 离线示例

无需 API key 的 Scripted Model Profile：

```sh
pnpm build
node apps/cli/dist/bin.js \
  --config examples/scripted-agent/seal-harness.config.mjs \
  --provider scripted \
  --model demo \
  "hello"
```

## 包结构

| 路径 | 职责 |
|---|---|
| `packages/kernel` | 服务拓扑、事件、Effect、回滚和卸载 |
| `packages/core` | Provider-neutral Agent 能力契约 |
| `packages/host` | Profile 发现、校验和启动 |
| `packages/plugin-manager` | 隔离安装、诊断、启停和删除 DSH 插件 |
| `packages/sdk` | 高层 TypeScript SDK 与 RPC 子进程客户端 |
| `python/sdk` | Python SDK、上下文管理器和同步 RPC 客户端 |
| `plugins/runtime-pi` | Pi Agent Runtime 适配 |
| `plugins/runtime-scripted` | 不依赖 Pi/Provider 的替代 Runtime |
| `plugins/provider-pi-ai` | Pi AI ModelService |
| `plugins/agent-core` | Context/Session/Runtime 编排 |
| `plugins/agent-presets` | Session 固定的系统提示与工具能力组合 |
| `plugins/tools-core` | Policy、Session 工具遮蔽/限制、单调 Guard 与协作式超时执行管线 |
| `plugins/agent-team` / `plugins/agent-team-tools` | 持久具名 teammate、可靠 peer mailbox、共享 CAS 任务 DAG 与九个 Agent Team 工具 |
| `plugins/spill-local` | 大型纯文本工具结果的私有 Session 分区外置存储与限额预览 |
| `plugins/settings-file` | 命名空间配置分层、路径 mutation、乐观版本控制、热重载与原子 JSON/YAML 持久化 |
| `plugins/subagent-tools` | 子 Agent 后台执行、持久归属与控制工具 |
| `plugins/jobs-local` | 后台 Job 生命周期、归属隔离和控制工具 |
| `plugins/terminal-pty` | 持久 PTY、终端输入输出和 Job 集成 |
| `plugins/goal-tools` | 持久 Goal 状态机、revision 校验与模型控制工具 |
| `plugins/session-query-tools` | 工作区范围的历史 Session 搜索、谱系和原始事件查询工具 |
| `plugins/schedule-tools` | Session 持久提醒、重启恢复与定时唤醒工具 |
| `plugins/workflow-tools` | Worker 隔离的 JavaScript 多 Agent Workflow 编排工具 |
| `plugins/webhook-core` | 即发即弃的可信 Webhook 规则注册与根 Session 创建 |
| `plugins/webhook-github` | 带 HMAC-SHA256 验证的可选 GitHub HTTP 适配器 |
| `plugins/lsp-core` | 按扩展名选择 Language Server 的 LSP 能力 seam |
| `plugins/lsp-stdio` | 按 workspace 复用进程的通用 stdio Language Server host |
| `plugins/lsp-tools` | 模型侧只读 `lsp` 精确代码导航工具 |
| `plugins/web-core` | Web search/fetch provider 选择与统一错误契约 |
| `plugins/web-fetch-http` | DNS 固定和公共地址限制的匿名 HTTP(S) 抓取 |
| `plugins/web-search-exa` | 动态凭据解析的可选 Exa 搜索 provider |
| `plugins/web-tools` | 模型侧 `web_search` / `web_fetch` 与不可信内容标记 |
| `plugins/user-questions` | 校验式用户问答 waterfall 与计划评审语义 |
| `plugins/ask-user-tool` | 模型侧结构化 `ask_user_question` 工具 |
| `plugins/commands` | 绕过模型、成对记录生命周期的 Slash Command 注册表 |
| `plugins/feedback-tools` | `/feedback` 与独立 sidecar 的消息评级/备注 |
| `plugins/goal-round-driver` | 同 Session 自动 Goal 续轮、轮次计数与上限阻塞 |
| `plugins/todo-tools` | Session 所有的结构化 Todo 整表替换与状态投影 |
| `plugins/plan-mode` | 持久 Plan Mode、条件指导和审批退出工具 |
| `plugins/permission-presets` | Session 持久的 sandbox/approval 权限束、投影与切换命令 |
| `plugins/sandbox-local` | 失败关闭的进程 Sandbox；Windows ACL restricted token 后端 |
| `plugins/compaction-*` | LLM 摘要压缩与确定性窗口降级 |
| `plugins/workspace-tools` | 文件、搜索和 Shell 工具 |
| `plugins/session-*` | 可替换 Session Store |
| `plugins/skills-filesystem` | 按 `$name` 展开的文件系统 Skills |
| `plugins/mcp-client` | 官方 SDK 驱动、经过 Policy 的 MCP 工具 |
| `plugins/dsh-compat` | 可选的 DSH/Cordis 插件兼容宿主与工具桥接 |
| `apps/cli` | Headless 入口与默认 Profile |
| `apps/rpc` | 严格 stdout JSONL RPC 入口 |
| `apps/acp` | 标准 ACP stdio Server、Session 生命周期和客户端权限桥 |
| `apps/web` | Local-first WebUI、HTTP 流式 Host 与浏览器审批 |
| `apps/launcher` | `run`、`headless`、`web`、`acp` 统一命令入口 |

## 插件

插件开发从 [`docs/plugin-development.md`](docs/plugin-development.md) 开始；DSH 插件见
[`docs/dsh-compatibility.md`](docs/dsh-compatibility.md)。安全模型见
[`docs/security.md`](docs/security.md)，总体架构见
[`docs/architecture.md`](docs/architecture.md)。
Session 物理格式和恢复语义见 [`docs/session-format.md`](docs/session-format.md)。
日常使用见 [`docs/user-guide.md`](docs/user-guide.md)，公共契约索引见
[`docs/api.md`](docs/api.md)。

```sh
seal-harness plugin --profile web add 'github:user/repo#path:/plugin'
seal-harness plugin --profile web list
seal-harness plugin --profile web doctor
seal-harness plugin --profile web remove '@scope/plugin'
```

## 验证

```sh
pnpm clean
pnpm check
pnpm build
```

测试包含真实 Pi Agent loop 的文本流、工具调用和临时仓库 Headless E2E；模型响应
使用确定性 Scripted Model，因此不消耗 API key。

## License

MIT
