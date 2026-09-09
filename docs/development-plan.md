# Seal Harness 开发计划

本计划由目标和验收证据驱动。除外部账户登录、浏览器安全确认等必须由用户完成的
边界外，实施过程中不等待普通技术决策审批。

## M0：仓库与决策基线

交付物：

- 本地 Git 仓库和 GitHub 私有仓库；
- Node/pnpm workspace、许可证、基础检查命令；
- 架构文档与 ADR；
- CI 基线。

验收证据：

- `git status -sb` 显示本地与 `origin/main` 同步；
- `pnpm check` 和 `pnpm build` 通过；
- GitHub Actions 在 `main` 上通过。

## M1：零依赖插件微内核

交付物：

- 类型化服务令牌；
- Profile 与稳定拓扑排序；
- 顺序类型化事件；
- 作用域 Effect、AbortSignal、逆序卸载；
- 启动失败完整回滚；
- 明确的重复服务、缺失服务和循环依赖错误。

验收证据：

- 单元测试覆盖正常启动、可选依赖、事件顺序、清理顺序、失败回滚和非法图；
- `@seal-harness/kernel` 构建产物可被 Node ESM 导入；
- 包的 `dependencies` 为空。

## M2：领域契约与测试替身

当前状态：已完成。Memory Session、Scripted Model 与完全不依赖 Pi/ModelService 的
Scripted Runtime 均可作为独立 Profile 插件运行。

交付物：

- Runtime、Model、Session、Tool Registry、Policy、Context、Credential 的窄接口；
- 标准事件词汇和 branded ID；
- Memory Session、Fake Model、Fake Runtime 测试插件；
- Profile 组合测试工具。

验收证据：

- 不依赖 Pi 或网络即可运行一次包含工具调用的确定性 Agent 场景；
- Session 事件能够重放为相同消息历史；
- 工具未经 Policy 决策不能执行。

## M3：Pi 适配层

交付物：

- `runtime-pi`：包装 `@earendil-works/pi-agent-core` 的 `Agent`；
- `provider-pi-ai`：精确配置所选 Provider 和模型；
- Pi 消息、工具、用量、错误与 Seal Harness 契约的双向转换；
- 上游兼容契约测试。

验收证据：

- 文本流、单/并行工具调用、工具错误、Abort、Steering、Follow-up 测试通过；
- Pi 依赖只存在于两个适配包；
- Fake Runtime Profile 仍可在不安装 Provider 凭据时运行。

## M4：最小可用 Headless Agent

交付物：

- JSONL Session 插件；
- Tool Registry 和工作区 read/write/edit/search/shell 工具；
- `workspace-write + ask` Policy；
- Credential 环境变量解析；
- AGENTS.md/系统提示上下文插件；
- Headless CLI 和默认 Profile。

验收证据：

- 临时工作区 E2E：读取文件、修改文件、执行验证、输出最终答复；
- 工作区外写入被拒绝；高风险命令进入审批；
- API key 不出现在日志、Session 或错误快照；
- 中止后无遗留子进程。

## M5：可恢复性与上下文管理

当前状态：已完成。Session resume/fork、JSONL 事务尾行恢复、增量持久化屏障、
中断工具非重放恢复、可插拔 Compaction、内容寻址附件和通用工具输出截断均已落地；
真实 Pi loop 长历史 E2E 已验证压缩后继续运行。

交付物：

- Session resume/fork；
- 原子追加和异常尾行恢复；
- Compaction 插件；
- 附件引用和大工具结果截断；
- 崩溃恢复与幂等边界说明。

验收证据：

- 在模型响应、工具执行、Session 写入三个故障点注入崩溃后可恢复；
- 重放不会重复执行标记为不可安全重放的工具；
- 长上下文 E2E 在阈值处触发 Compaction 并继续完成任务。

## M6：可选生态插件

当前状态：已完成。Filesystem Skills、官方 SDK MCP Client、Node SQLite Session、
JSONL RPC 和默认无网络 Telemetry 均为独立插件/入口；离线最小 Profile 不依赖这些
可选能力仍可运行。

交付物：

- Skills 文件系统插件；
- MCP 客户端插件；
- SQLite Session 插件；
- RPC 入口；
- Telemetry 接口及默认关闭实现。

验收证据：

- 所有插件从默认 Profile 移除后，核心 CLI 仍能启动；
- 可选插件各自拥有隔离的集成测试；
- Telemetry 默认不发起网络请求。

## M7：发布准备

当前状态：已完成。用户/API/安全/版本文档、Changelog、Dependabot、CI、手动 Release
Candidate 工作流和可发布包 tarball clean-install smoke 均已验证；GitHub 私有仓库和
`origin` 已建立，`main` 已同步，远端 Actions 在 Node 22.19/24 及打包安装任务中通过。

交付物：

- 用户指南、插件开发指南、API 文档和示例；
- 安全威胁模型、版本兼容策略、变更日志；
- npm pack 校验、最小安装 smoke test；
- GitHub Actions、Dependabot/Renovate 策略和发布流程。

验收证据：

- 从空目录按 README 能安装并运行示例；
- 打包内容不含源码缓存、凭据、Session 或测试产物；
- 支持矩阵中的 Node 平台全部通过 CI；
- 完整 `pnpm check`、`pnpm build`、E2E 和 pack smoke test 通过。

## M8：DeepSeekHarness 能力对齐

当前状态：进行中。已加入持久子 Agent 服务、统一后台 Job 注册表、模型侧控制工具、
持久 PTY 终端、LLM 摘要 Compaction，以及自定义 Provider 探测与立即调用闭环；后续
ACP 核心协议、Goal 持久状态机、同 Session 自动续轮、Todo、Plan Mode、跨平台
进程 Sandbox，以及 Web 工具状态侧栏主链路已对齐。

已交付：

- 子 Agent 后台启动，不阻塞父 Agent 工具调用；
- 父子 Session 归属和标签持久化，进程重启后仍可查询已完成子 Agent；
- `spawn_agent`、`list_agents`、`wait_agents`、`send_message`、`abort_agent`；
- 每个父 Session 的并发上限和跨父 Session 控制隔离；
- Session 归属的 Job 注册、并发限制、增量输出、等待、取消和退出清理；
- `job_list`、`job_output`、`job_wait`、`job_kill`，且子 Agent 同步发布为 Job；
- 基于 `node-pty` 的跨平台持久终端、Session 所有权隔离、输出上限和 Job 生命周期；
- `terminal_start`、`terminal_send`、`terminal_read`、`terminal_list`、`terminal_kill`。
- Session 日志持久化的 Goal 状态机、乐观 revision 校验，以及 `get_goal`、`create_goal`、
  `update_goal` 工具；恢复或 fork 后 activation 默认 disarmed。
- Goal 完成一轮后使用原模型和工作目录继续同一 Session；只计入自动续轮，并在达到
  `maxGoalRounds` 后写入稳定的 `round-limit` 阻塞原因。
- `todo_write` 整表替换、内容去重、并行 in-progress 策略、Session 持久化，以及下一轮
  开始时清除 standing-plan 视图。
- Plan Mode 状态随 Session 持久化和 fork，激活时注入部署指导；`exit_plan_mode` 使用
  审批通道展示完整 Markdown 方案，批准后退出，Web/RPC 提供状态读写端点。
- Sandbox 服务以 argv 边界包裹子进程并失败关闭；Linux 按 probe 选择 bubblewrap 或
  Landlock、macOS 使用 Seatbelt、Windows 使用 ACL restricted-token runner；Shell 与
  持久 Terminal 默认采用 `workspace-write`，返回 enforcement/denied 事实。
- WebUI 按 Session 聚合展示 Goal、Plan、Todo、Jobs、Subagents 和 Terminals；Plan 可在
  侧栏切换，`exit_plan_mode` 审批会以完整 Markdown 方案和专用按钮呈现；运行中的 Job、
  子 Agent 和 Terminal 支持带 Session 所有权校验的取消或中止操作。
- 通过当前 Agent 模型或专用路由生成上下文摘要，不向摘要调用暴露工具；
- Provider 摘要失败时确定性降级，调用取消时则严格传播取消。
- 支持 OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages 自定义路由；
- 兼容多种远端模型目录结构，探测后动态注册并由 WebUI 立即调用。
- TypeScript SDK 托管 RPC 子进程，支持握手、Session 复用、流式事件与可靠关闭。
- Python SDK 以纯标准库实现同等的同步运行、通知回调和上下文托管。
- 官方 ACP SDK 驱动 stdio 协议，支持持久 Session 生命周期、流式更新、取消和权限回调。
- ACP stdio/Streamable HTTP MCP 按 Session 建立连接和注册工具，同名工具可跨 Session
  隔离共存，并在 Session close 时确定性释放。
- ACP `session/list` 覆盖活动与持久 Session，提供稳定 opaque keyset cursor 分页。
- ACP 按 Session 暴露并持久化 Model/Reasoning 配置，切换操作串行且失败回滚。
- ACP 使用 activation reservation 消除同一 Session 的并发 resume 竞态，close 在释放前
  等待配置写链稳定。
- `workflow` 在独立 Worker 中执行只含编排 Hook 的 JavaScript，支持 `agent`、`parallel`、
  `pipeline`、阶段、日志、结构化子结果、并发/总量/集合上限与有界取消；子任务复用
  `SubagentService`，运行和成员生命周期写入父 Session。
- `schedule_create`、`schedule_list`、`schedule_delete` 支持延迟、IANA 时区绝对时间和固定
  频率提醒；规则写入 Session、启动时恢复，固定频率直接跳过漏跑区间。提醒 dispatch 与
  唤醒消息通过 Agent prelude 事件原子提交，并复用最近一次 Model/Reasoning 路由。
- 默认 Profile 提供 `session_search`、`session_event_search`、`session_trace`、
  `session_event_trace`、`session_event_read`；查询严格限制到调用方工作区，并直接读取
  Session Store，不会为历史 Session 创建或恢复 Agent。事件表面映射为当前、已被压缩
  遮蔽和仅日志三类。
- DSH 工具的 `deferContext()` 追加上下文会按结果顺序进入下一模型步骤；`concludeTurn()`
  在同批工具结果、追加上下文和并发 steering 排空后结束当前轮，并保留错误结果语义。
- DSH 兼容 Profile 可直接从 `cordis.yml` 启动官方 Loader 树；Include、Group、嵌套条目、
  禁用状态、注入等待与 `!!js` 表达式均复用 DeepSeek 官方 Cordis 插件实现并参与启动结算。
- DSH 兼容 Profile 可显式启用官方 Cordis HMR；源码与配置文件变化会替换对应 Loader
  Fiber 并回收旧副作用，普通 Node 启动通过跨平台内部 Loader 桥接工作，无需额外启动参数。
- Web Client 兼容运行时支持基于 `inject` 的适配器解析，并内置 DSH `locale` 服务；第三方
  客户端插件可注册双语词典、绑定参数化翻译、订阅语言变化，并与 Seal 语言设置双向同步。
- Web Client 内置 `modules` 适配器，公开 client 模块缓存及 import/prefetch/invalidate，
  让依赖模块系统而不依赖 React Shell 的 DSH 客户端插件可直接激活并正确卸载。
- Web Client 内置同实例 React Slots、`uiSession` 与 Store 适配器；root/session/session-maybe
  子树会随当前 Session 选择重渲染，严格 Session 槽在未选择时隐藏，Store 状态按作用域隔离并复用。
- Web Client 提供 Session/Workspace observable 标准 kit；Workspace 命令映射现有 Host registry，
  包含可持久恢复的 Workspace 内 Session 手动顺序。
- DSH Host 默认组合官方 TypeScript worker-thread Code Runtime 和 JSON-backed Storage Domain；
  代码 binding 往返与 schema-validated KV 跨重启恢复均由集成测试覆盖。
- Web Client 内置 `remote.commands`、`remote.settings`、`remote.agentPresets` 与
  `remote.pluginInventory`，按 DSH `RemoteResult` 契约折叠 HTTP/取消/领域冲突失败；命令、
  设置、preset roster/选择和插件生命周期清单不再要求第三方手工注入适配器。
- Web Client 的 `remote.session` 已提供冷 Session 列表和模型目录；列表从 Host 活跃运行表
  投影 running，并保留 blank、工作目录和子 Agent 父级关系，模型按 provider 分组并公开 reasoning。
- `remote.session.create/rename/fork` 已落到持久 Session Store；显式 id 创建可幂等采用，preset
  在写入前预检可用性以避免失败后残留半创建 Session，fork 只接受已完成轮次边界。
- `remote.session.selectModel/cancel` 已使用 Host 模型注册表和活跃运行表；选择结果持久化到
  Session，并在下一次未显式指定模型的运行中生效，不支持的模型/reasoning 与空闲取消均返回领域错误。
- `remote.session.prompt` 已实现接纳即返回：空闲 Session 后台排空完整运行，活跃 Session 将
  queue 映射为 follow-up、steer 映射为 steering；图片经 AttachmentService 内容寻址持久化，
  request id、IANA 时区、内容类型、canonical base64 与大小在任何模型副作用前校验；
  request id 与时区作为 `user-rpc` source 持久化，并由 Pi 适配器跨消息转换保留；活跃运行的
  图片队列使用“持久引用 + Pi 内联投影”双表示，队列控制和最终日志仍保留内容地址引用。
- `remote.session.search` 直接读取持久 Session，不激活 Agent；结果限制到可见未归档 Session 和
  当前消息表面，按 DSH 契约去重到每 Session 一条并执行 20 条/240 Unicode code-point 上限。
- `remote.session.attachment` 不信任 MIME 或全局内容地址：先证明引用存在于目标 Session 日志，
  再校验存储字节 SHA-256，并解析 PNG/JPEG/GIF/WebP 文件头得到真实宽高后生成 DSH 引用。
- `remote.session.page/follow` 使用独立的连续 DSH wire cursor：Seal 事件可展开为 DSH
  turn/step/tool 生命周期，未知扩展以 `ignorable` 事件保真保留；历史页按消息边界反向截取，
  NDJSON follow 先发布完整 snapshot，并在持久追加时只发送重投影后的 cursor 后缀；历史图片引用
  从附件服务解析真实 MIME、字节数与宽高，解析失败时不破坏日志或 cursor。
- `remote.session.control/updateQueue` 已以真实 Runtime inbox 为权威来源：Pi 0.84.3 的实际消费
  队列通过带布局校验的适配器公开稳定消息 ID、快照、变更订阅、编辑、删除和 queued→steering；
  control 同时发布 owner-scoped Job 更新与 Session projection baseline/增量；projection 包含按实际
  `run.started` 与待生效选择折叠的 `modelSelection`，以及与远程图片数量、字节、像素和边长校验
  一致的 `imageLimits`。取消结束后，剩余 inbox
  的所有权原子转移到 Host parked inbox，仍可编辑，并在下一条 DSH prompt 或普通 Web run 到达时
  按原顺序交还新执行；启动失败会恢复原 parked inbox。
- DSH Host Cordis 上下文已注入通用 `connection` 服务：第三方 Host 插件可注册独立 RPC channel，
  Browser 插件通过 `ctx.connection.rpc.call()` 使用带 `rpcId` 的标准 envelope 调用；Host/Client 两端
  均校验 channel、endpoint、method 与响应关联，网络断开通过 AbortSignal 传递给处理器。共享
  `/api` 支持 matcher 所有权拦截与精确 Fetch 路由，未命中请求继续交给 Seal，核心路径受冲突栅栏保护。
- Browser 模块运行时已将包图与服务等待分离：插件包 manifest 的 `dsh.client.inject` 形成模块
  拓扑，bundle factory 先注册后物化，插件导出的 `inject` 才参与 Cordis 服务等待；运行时发布
  `modules.manifest` 与 `window.__DSH_BOOT__`，记录同步 require 边并检测循环。依赖版本变化或手动
  invalidate 会沿 `inject`、动态 `external` 与已观察 require 边的反向图级联卸载，并以传入 revision
  和 reload epoch 绕过 ESM 缓存后重建；manifest consistency revision 覆盖 URL 和完整依赖字段。
  初次到达使用同一 revision 校验的组合 batch 一次注册整图 factory；失效后的模块改用单包 URL，
  过期 batch 请求以冲突响应拒绝，避免跨图混装。

## 全程约束

- 默认 Profile 每增加一个运行时依赖都必须说明能力收益；
- 公共插件 API 变更必须更新契约测试和迁移说明；
- 不通过 `runtime-pi` / `provider-pi-ai` 泄漏 Pi 专有类型；
- 不以 Mock 通过替代真实 Pi E2E；Mock 只负责确定性测试；
- 不以单元测试替代安全、恢复和发布范围的验收证据。
