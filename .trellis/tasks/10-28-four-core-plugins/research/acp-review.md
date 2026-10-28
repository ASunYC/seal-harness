# ACP 独立只读审查

审查者：Token 统计子智能体。范围仅 `seal-harness-desktop/plugins/acp/` 及对应已安装 DSH/ACP SDK 公开契约；没有修改 ACP 或共享实现，没有运行整套构建，也没有启动真实第三方编程 CLI 或计费模型调用。

## 已发现并由 ACP 负责人修正

1. 历史操作清理调用未定义 `active(run)`，第二次启动可能 ReferenceError。已改为从 `jobs` 集合推导活动状态，不维护第二份状态判断。
2. `transport.js` 原本使用 `stdio.stderr: 'ignore'`，但 DSH `SubprocessOutputMode` 仅支持 `pipe/inherit/{maxBytes}`。真实 `subprocess-local` 把非 pipe/inherit 模式按 collector 处理，`'ignore'.maxBytes` 为 undefined，异常 Runner stderr 会无界累计；原测试假适配器的原生 stderr ignore 掩盖了差异。现已改成 `{maxBytes:4096}`，并补真实 `LocalSubprocessRuntime` 用例。
3. 可执行文件/cwd 查找挂起时，原 open 只在 await 前后检查 abort，取消和 startup deadline 不能及时结束等待。现已加 `abortable` 并把 signal 传入公开 resolver，独立 deferred resolver 探针确认 abort 后 100ms 内 open 已完成退出，未 spawn。
4. 配置允许显式 PATH/PATHEXT，但原发现逻辑未传 resolver 的 env 参数，会误报用户自定义 PATH 里的 Runner 未安装。现 discover 接收 environment，transport 与 snapshot 均传入本账号保存的显式环境；独立探针已核对参数传递。

负责人已在修复的 mutation/launch 竞态和 cleanupFailed 占用保留问题不重复列为本次新发现。

## 公开契约与行为核对

- 已安装 `@agentclientprotocol/sdk@1.4.0` 的 `client(...).connect(ndJsonStream(...))` 返回 `ClientConnection`，包含 `agent.request/notify` 与 `close/closed/signal`，当前 transport 用法相符。
- 请求/通知使用公开 `methods.agent.initialize/session.new/session.prompt/session.cancel` 和 `methods.client.session.update/session.requestPermission`，不是用普通 shell 输出冒充 ACP。
- Windows 可执行路径走 DSH `subprocess.resolveExecutable`，命令与参数分开传递且不 shell-interpreted。`.cmd/.bat/.ps1` 明确提示改为原生 Node 可执行文件与真实 JS adapter 入口；独立探针确认 .cmd 不标为 supported。
- spawn、done、terminate、waitForExit 按 DSH 的受管进程范围工作；清理通过真实 waitForExit 确认，不仅依赖父进程 exit。配置变更/停用/删除会先停止任务。
- 权限默认 reject；可选配置只选择请求中的 allow_once，不选择 allow_always；请求还核对 ACP sessionId。Client UI 明确说明该选项为“每次请求的单次允许项”。它不是操作系统沙箱。
- 环境秘密只保存在按 owner/id 区分的 Host credentials，公开快照仅返回名称；异步配置、snapshot 与执行都复核账号/epoch。账号切换会取消活跃任务，读取/取消范围受账号限制。
- ACP 模型工具使用 `defineTool` 的 author schema，并声明输出 schema/render。使用真实 `Context + SystemPrompt + ToolRuntime` 载入 ACP 插件的只读探针确认 `list_acp_runners` 和 `acp_runner` 均注册成功，参数 schema 的 id/prompt 均为 required；fiber.dispose 后注册被正确移除。

## 实际复测

- `node --test --test-name-pattern='public LocalSubprocessRuntime|cancel exits' seal-harness-desktop/plugins/acp/tests/service.test.mjs`：2/2 通过。
- deferred resolver abort 探针：`settledAfterAbort:true`，无子进程启动。
- 显式 env 查找与 Windows 脚本拒绝探针通过。
- 真实 DSH ToolRuntime 工具注册/卸载探针通过。

在上述修正后的源码状态，没有确认新的阻断项。完整产品装配、真实商业 CLI 登录/权限行为和其他平台仍由主智能体/后续真实环境验收，不将受控 Runner 测试称为所有 CLI 已可用。
