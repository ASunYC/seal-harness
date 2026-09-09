# 公共 API 概览

## `@seal-harness/kernel`

- `createServiceToken<T>(name)`：创建类型化服务标识。
- `definePlugin(definition)`：定义静态插件边界。
- `plugin(definition, config, options)`：创建 Profile 实例。
- `Kernel.start()` / `stop()`：启动和逆序卸载；`reconfigure()` 保留未变化的拓扑前缀、重启变化后缀，并在失败时回滚。
- `PluginContext`：`use`、`provide`、`on`、`emit`、`effect`、`signal`。

## `@seal-harness/core`

标准服务令牌：

| Token | Contract |
|---|---|
| `agentServiceToken` | `AgentService` |
| `attachmentServiceToken` | `AttachmentService` |
| `runtimeToken` | `AgentRuntime` |
| `modelServiceToken` | `ModelService` |
| `subagentServiceToken` | `SubagentService` |
| `jobServiceToken` | `JobService` |
| `terminalServiceToken` | `TerminalService` |
| `goalServiceToken` | `GoalService` |
| `todoServiceToken` | `TodoService` |
| `planModeServiceToken` | `PlanModeService` |
| `sandboxServiceToken` | `SandboxService` |
| `scheduleServiceToken` | `ScheduleService` |
| `lspServiceToken` | `LspService` |
| `webhookRuntimeToken` | `WebhookRuntime` |
| `webRouteServiceToken` | Web Host 提供的 `WebRouteService` |
| `webAccessServiceToken` | `WebAccessService` |
| `sessionStoreToken` | `SessionStore` |
| `toolServiceToken` | `ToolService` |
| `policyServiceToken` | `PolicyService` |
| `approvalServiceToken` | `ApprovalService` |
| `contextServiceToken` | `ContextService` |
| `compactionServiceToken` | `CompactionService` |
| `credentialServiceToken` | `CredentialService` |
| `telemetryServiceToken` | `TelemetryService` |

事件类型通过 `SealHarnessEvents` 统一，Session 使用 `SessionEventMap` 判别联合。公共
消息和模型接口不暴露 Pi 专有类型。

`@seal-harness/workflow-tools` 导出 `WorkerWorkflowRunner` 和 `workflowTool()`。默认 Profile
注册 `workflow`，在清空环境变量和启动参数的 Worker 中执行模型编写的 JavaScript；
脚本只获得 `agent`、`parallel`、`pipeline`、`phase`、`log` 和 `args`。子任务通过现有
`SubagentService` 启动，因此继承 Session 所有权、Job、并发限制与取消语义。

`@seal-harness/schedule-tools` 提供 `ScheduleService`，并注册 `schedule_create`、
`schedule_list`、`schedule_delete`。规则支持延迟秒数、严格 offset RFC 3339、显式 IANA
时区的本地日期时间，以及最短五分钟的固定频率。dispatch 事件通过
`AgentPromptRequest.preludeEvents` 与提醒消息、`run.started` 在同一 Session append 中提交。

`@seal-harness/webhook-core` 提供与厂商无关的 `WebhookRuntime`。可信插件通过
`register(rule)` 注册规则，已认证适配器调用 `dispatch(delivery)` 后立即返回；规则可返回
workspace、标题、提示词和模型选择，从而创建普通根 Session。可选的
`@seal-harness/webhook-github` 通过 Web Host 精确路由动态解析密钥、限制原始 body、验证
`x-hub-signature-256`，并以 `202` 接受有效交付。

LSP 分成三个可替换层：`@seal-harness/lsp-core` 提供按最终扩展名原子注册和选择 provider
的 `LspService`；`@seal-harness/lsp-stdio` 按 canonical workspace 懒启动并复用配置的
language-server 进程，每次查询执行临时 didOpen/query/didClose；`@seal-harness/lsp-tools`
提供统一的只读 `lsp` 工具，将模型的一基 UTF-16 坐标转换为协议坐标并限制结果大小。

`@seal-harness/web-core` 在每次调用时确定唯一可用或显式指定的 search/fetch provider，并
统一结构化 `WebError`。默认 Profile 启用 `@seal-harness/web-fetch-http` 和
`@seal-harness/web-tools`；公共抓取执行 DNS 解析后固定连接地址，拒绝非公共目标、URL 凭据
和跨 origin 自动重定向。`web_search` 支持并发多查询、失败批量取消、按排名轮询合并与 URL
去重；`web_fetch` 使用 DOM 转换为 GFM Markdown，并在所有外部内容前标记不可信边界。

## `@seal-harness/host`

- `defineProfile(specs)`：冻结 Profile。
- `loadProfile({ cwd, configPath })`：发现并验证原生 ESM Profile。
- `startProfile(profile)`：创建并启动 Kernel。

## `@seal-harness/web`

- `startWebServer(options)`：启动本地 HTTP Host、静态 WebUI 和 Agent 流式 API；
- `WebApprovalService`：公开待审批请求并由浏览器决定 allow/deny；
- `runWebCli(argv, environment)`：`seal-harness web` 的可嵌入入口。

HTTP API 包含模型、Session、运行流、中止、审批和进程内 Credential 端点；Session 状态
端点聚合 Goal、Plan、Todo、Jobs、Subagents 和 Terminals，并提供按 Session 校验所有权的
Job 取消、Subagent 中止和 Terminal 终止端点；
`GET /api/events` 通过 SSE 推送模型、设置和 Session 持久化失效事件；
`GET /api/sessions/:id/messages` 在核心 surface fold 上提供默认 200 条的逻辑消息窗口、
向前分页游标和 replace generation；
`POST /api/providers/discover` 会探测并注册可立即调用的自定义 Provider。运行响应
使用 `application/x-ndjson` 持续发送 RuntimeEvent。

`@seal-harness/provider-pi-ai` 导出 `PiAiCustomProvider`、`createCustomProvider()`、
`discoverProviderModels()` 和 `parseModelCatalog()`；`PiAiProviderConfig.customProviders`
用于声明需要随 Profile 启动的自定义路由。

`@seal-harness/acp` 在 `session/new` 与 `session/resume` 接受 stdio 和 Streamable HTTP
MCP 声明。动态工具按 Session 注册，`session/close` 时注销并关闭连接；与 DeepSeekHarness
一致，非空 `additionalDirectories`、SSE 和实验性 ACP MCP transport 会明确拒绝。
`AcpServerOptions.sessionListPageSize` 控制 `session/list` 每页上限（默认 100）；响应使用
按创建时间和 Session ID 排序的 opaque keyset cursor。
`session/new` 和 `session/resume` 返回 Provider 分组的 `model` 选择器；支持推理的模型还
返回 `reasoning_effort`。`session/set_config_option` 串行校验并持久化选择，后续 Prompt
和再次 resume 都使用该 Session 自己的路由。

## `@seal-harness/sdk`

- `new SealHarness(options)`：配置工作区、Provider、模型、Profile 与 RPC 子进程；
- `start()` / `close()` / `Symbol.asyncDispose`：初始化握手与共享同一 Promise 的幂等进程回收；关闭按协议 shutdown、stdin EOF、SIGTERM（POSIX）和 SIGKILL 阶梯执行，并确认退出；
- `session(id?)`：创建或复用具名 Session；
- `run(prompt, options)`：收集流式 RuntimeEvent、最终文本、停止原因和通知。
- `client.subscribe(filter?)`：独立的可过滤异步通知流，支持 `next()`、`tryNext()` 和显式关闭；
- `client.subscribeSessionTree(id)`：订阅一个 Session 及运行中发现的子 Agent 血缘。

SDK 默认启动随 `@seal-harness/rpc` 安装的运行时，也支持通过 `command`/`args` 注入自定义
进程，便于嵌入、测试或发行包启动。普通请求默认不设超时；可用 `requestTimeoutMs` 显式
限制，并分别用 `shutdownTimeoutMs`、`disposeEofGraceMs`、`disposeGraceMs` 控制关闭阶段。

## Python SDK

`python/sdk` 中的 `seal_harness.SealHarness` 提供相同的上下文管理、`session()`、`run()`、
通知回调与 `RunResult`。低层 `HarnessClient` 还提供 `subscribe(filter?)` 和
`subscribe_session_tree(id)` 同步通知流；订阅支持阻塞 `next(timeout)`、非阻塞
`try_next()` 与显式关闭。实现只依赖 Python 标准库，默认启动 PATH 中的
`seal-harness-rpc`，也可通过 `SealHarnessConfig(command=..., args=...)` 覆盖。

普通请求默认不设超时。初始化失败后会回收旧进程并允许新进程重试；关闭依次执行协议
shutdown、stdin EOF、POSIX terminate 与 kill，并由 `shutdown_timeout`、
`dispose_eof_grace_timeout`、`dispose_grace_timeout` 分别设置界限。显式 `env` 是完整的子进程
环境；省略时才复制当前进程环境。

## `@seal-harness/launcher`

- `runLauncher(argv, environment)`：分派 `run`、`headless` 和 `web` 产品模式。

## `@seal-harness/acp`

- `startAcpServer(profile, options)`：在官方 ACP `Stream` 或 stdio 上启动 Agent Server；
- `AcpApprovalService`：把 Seal Approval 转换成 ACP `session/request_permission`；
- `runAcpCli(argv)`：统一启动器使用的 ACP 命令入口。

服务公开标准 Session 创建、列表、恢复、关闭、Prompt、取消和流式更新；返回句柄允许嵌入方
显式关闭连接及 Kernel。

## `@seal-harness/dsh-compat`

- `dshCompatPlugin`：在 Seal Profile 中托管真实 Cordis Context 和 DSH 插件；
- `DshCompatRuntime`：可嵌入的 Cordis 生命周期宿主；
- `dshCompatServiceToken`：访问兼容 Context 与 Fiber；
- `DshCompatConfig`：配置 DSH 插件、额外 Cordis 服务、启动超时与工具风险。

当 Profile 已提供 `toolServiceToken` 时，兼容层自动提供 Cordis `ctx.tools` 桥。DSH 工具
会转换成 Seal `ToolDefinition`，继续经过 Policy 与 Approval。

## `@seal-harness/plugin-manager`

- `PluginProfileManager`：管理 `~/.seal-harness/profiles/<name>` 隔离依赖；
- `add()` / `remove()` / `list()`：安装、删除和列出插件；
- `doctor()`：检查 Host/Client `inject` 和缺失适配器；
- `loadHostPlugins()`：把启用的 DSH Host 入口交给 Cordis 兼容层；
- `runPluginCli()`：实现 `seal-harness plugin` 命令。

完整类型定义以各包生成的 `.d.ts` 为准。公开符号由每个包的 `src/index.ts` 控制。

## Interaction 与 Feedback

Web Host 的 `/api/workspaces` 提供持久工作区列表、创建、重命名、删除与顺序更新；
`PUT /api/sessions/:id/archived` 控制 Session 是否出现在分组中。路径在 Host 上通过
`realpath` 规范化，同一路径只注册一次。删除仅移除侧栏注册信息，不删除工作目录、用户文件或
Session 日志。首次启动会根据已有 Session 的创建事件引导工作区列表。
隐藏后的 Session 从普通 `/api/sessions` 列表移除，并可通过 `/api/archived-sessions` 查找和恢复。
`PUT /api/sessions/:id/title` 将名称作为 `session.metadata` 追加到同一事件日志，列表始终投影最新名称。

`POST /api/attachments` 接受名称、MIME 类型和最多 20 MiB 的 base64 数据，通过当前
`AttachmentService` 返回内容寻址引用。引用随用户消息持久化；
`GET /api/attachments/:sha256Id` 只解析已知内容，不接受文件路径，并以安全的
Content-Disposition 返回。图片、PDF 可内联，其余类型强制下载。

Web CLI 默认启用认证：每次启动的 `launchUrl` 携带新的交换 token，成功交换后设置持久的
HttpOnly Strict Cookie，并重定向到不含 token 的根路径。嵌入方调用 `startWebServer()` 时可用
`authenticate: true` 启用相同机制，并通过 `authCredentialPath` 指定凭据位置。

Web Host 在运行期间接受 `POST /api/runs/:runId/messages`。请求体的 `prompt` 是新用户消息，
`mode: "steer"` 将其送入当前模型轮次，`mode: "followUp"` 则排到当前轮次之后；已结束或未知
Run 返回 404。两种模式都接受 `attachments`，包括没有文本的纯附件消息；Host 在入队前验证
每个内容哈希确实存在。浏览器 Composer 在运行中公开这两种投递模式。

`@seal-harness/user-questions` 提供经过完整输入/答案校验的 answerer waterfall，
`@seal-harness/ask-user-tool` 将其公开为结构化 `ask_user_question` 模型工具。Web host 会列出
待答问题并提交单选、多选或自定义答案。

`@seal-harness/commands` 注册无需模型往返的 Slash Command，并为每次匹配写入成对的
`command.run` / `command.done` 事件。`@seal-harness/feedback-tools` 默认注册 `/feedback`；
逐条 Assistant 消息的赞/踩与备注采用 optimistic concurrency，原子写入绑定 Session
创建身份的独立 JSON sidecar，不进入模型历史或遥测；备注默认遵循 DeepSeek Web 的
8192 UTF-8 bytes 上限。

`ToolService` 支持 Session scoped 工具覆盖、只作用于全局工具的交集式 allow/deny 限制，
以及按“全局优先、随后 Session”的注册顺序执行的同步单调 Guard。任一 Guard 返回原因即拒绝，
后续 Guard 不能强制放行。工具可声明 `timeoutMs`；超时时会中止派生 signal、等待工具体静止，
再返回带 `TOOL_TIMEOUT` 细节的错误结果，不遗弃仍在运行的 Promise。

`@seal-harness/permission-presets` 将 sandbox mode 与 approval policy 作为一个可选权限束，
并在 Session 第一次模型请求之前原子补齐 `permission.preset`、`sandbox.mode`、
`approval.policy` 三个持久事实。`/permission`、Web 状态栏、Policy、Shell 和持久终端读取同一
Session 投影；切换 preset 后执行权限立即生效，重启恢复时仍由事件日志重建。

`@seal-harness/agent-presets` 在首轮请求前写入 `agent-preset.selected`，将 preset 的系统提示
和全局工具限制组合到目标 Session。只有尚未产生 message、run 或 tool 事件的空白 Session
可以切换；开始运行后终身固定，恢复时按日志重新安装工具限制。子 Agent 默认继承父 Session
的 preset，Web 新建会话选择器会随首个请求一起提交选择。
