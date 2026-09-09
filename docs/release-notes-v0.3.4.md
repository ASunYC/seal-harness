# Seal Harness v0.3.4

本次补丁版本继续对齐 DeepSeekHarness 的 Models 设置体验，并修复自定义 Profile 在
WebUI 中无法选择非内置 Provider 的问题。

## 主要变化

- Provider 选项直接来自当前 `ModelService` 返回的模型目录，不再维护浏览器端硬编码表；
- 自定义 Profile（例如 scripted 或第三方 Provider）现在可以直接在 WebUI 中选择；
- 分别记住每个 Provider 最近选择的模型；
- 显示模型路由、上下文容量、最大输出，以及 Reasoning / Images 能力；
- Models 页面显示当前目录中的 Provider 与模型数量。
- Models 页面可探测自定义 OpenAI/Anthropic-compatible Provider；远端模型目录会注册到
  当前运行时并可立即执行请求，API key 仍只保存在进程内存。
- 新增 `@seal-harness/sdk` 高层 TypeScript API，支持 RPC 子进程托管、初始化握手、具名
  Session 复用、流式通知、结果归集和有界关闭。
- 新增纯标准库 Python SDK，提供同步运行、具名 Session、通知回调与上下文管理器。
- 新增基于官方 SDK 的 ACP stdio Server，支持 Session 创建/列表/恢复/关闭、Prompt 流、
  取消、工具更新和客户端一次性权限决策，并接入 `seal-harness acp`。
- ACP new/resume 支持每 Session 的 stdio 与 Streamable HTTP MCP Server；工具仅向所属
  Session 暴露，并随 close 或 Server 停止释放连接。
- ACP Session 列表包含当前活动 Session，并支持稳定的不透明游标分页。
- ACP Session 提供按 Provider 分组的 Model 与 Reasoning 配置选项，支持
  `session/set_config_option`，并在 close/resume 后恢复已选路由。
- 同一 Session 的并发 resume 只允许一个请求成功；close 会先排空配置持久化队列。
- 新增持久子 Agent 服务，以及 `spawn_agent`、`list_agents`、`wait_agents`、
  `send_message`、`abort_agent` 工具；
- 子 Agent 在后台运行，父子归属写入 Session 元数据，完成结果可在重启后恢复查询；
- 子 Agent 控制严格限定在创建它的父 Session 内。
- 新增统一后台 Job 服务，以及 `job_list`、`job_output`、`job_wait`、`job_kill`；
- 新增持久 Goal 状态机、revision 冲突保护与 `get_goal`、`create_goal`、`update_goal`；
- 新增同 Session Goal 自动续轮、原模型路由复用、轮次计数和 `round-limit` 阻塞；
- 新增 `todo_write` 整表替换、去重校验、并行进行中策略和 Session 持久化；
- 新增持久 Plan Mode、条件规划指导、`exit_plan_mode` 审批退出及 Web/RPC 状态端点；
- 新增失败关闭的跨平台进程 Sandbox 服务：Linux bubblewrap/Landlock、macOS Seatbelt、
  Windows ACL restricted token；Shell 与 PTY 报告 mode、denied 与 enforcement；
- WebUI 新增 Session 状态侧栏，集中展示 Goal、Plan、Todo、Jobs、Subagents、Terminals，
  提供 Plan Mode 切换、完整 Markdown 方案审批卡，以及当前 Session 所属 Job、子 Agent
  和 Terminal 的取消/中止按钮；
- 子 Agent 会同步注册为所属父 Session 的 Job，可通过统一接口读取输出、等待或取消。
- 新增真实跨平台 PTY 终端和 `terminal_start`、`terminal_send`、`terminal_read`、
  `terminal_list`、`terminal_kill`，终端同时纳入 Job 生命周期。
- 默认 Compaction 升级为 LLM 摘要，摘要调用不进入 Agent loop、不暴露工具；Provider
  故障时自动回退至确定性窗口压缩，用户取消仍会立即传播。
- 新增工作区隔离的 5 个历史 Session 查询工具，支持 Session/父级/时间/事件过滤、
  谱系追踪、压缩前后事件表面、关联事件和有界原始事件邻居读取，查询不会激活旧 Agent。
- 新增 DSH 风格 `workflow` 工具：在清空环境的 Worker 中运行 JavaScript 编排脚本，支持
  并行、无阶段屏障流水线、进度阶段、结构化子结果、资源上限、取消传播和遗留子任务回收。
- 新增持久 Schedule：支持延迟、带 offset 或 IANA 时区的绝对时间、固定频率提醒、列表与
  删除；服务重启会重建定时器，漏过的周期直接前进，dispatch 和提醒输入原子写入 Session。
- 新增可选 Webhook 子系统：提供方无关的即发即弃规则运行时，以及限制请求体、动态密钥解析和 HMAC-SHA256 验证的 GitHub HTTP 适配器。
- 新增可选 LSP 子系统：扩展名路由 seam、通用 stdio language-server host，以及定义、引用、实现和 hover 的模型侧导航工具。
- 新增 Web search/fetch 能力族：确定性 provider 选择、SSRF 安全匿名抓取、可选 Exa 搜索，以及带不可信内容标记和 HTML→GFM 转换的模型工具。
- 新增结构化用户提问、无需模型往返的 Slash Command，以及 `/feedback` 和独立 sidecar 消息反馈；Web UI 同步支持问答、命令和 Assistant 消息赞/踩。
- 新增 Session 持久 Permission Presets；权限选择在首个模型请求前固定为 sandbox/approval 事实，并贯通 Policy、Shell、Terminal、Slash Command 与 Web 状态栏。
- 新增 Session Agent Presets：首轮前固定系统提示与工具可见性、运行后禁止切换、恢复时重建，并让子 Agent 继承父级组合；Web 新会话支持选择 preset。

## 兼容性

新增的 Provider API 均为向后兼容扩展，没有 Session 格式变更。现有 Profile 无需迁移。

## 验证

```sh
pnpm check
pnpm build
```
