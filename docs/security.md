# 安全模型

## 信任边界

PiHarness 插件是任意 Node.js 代码，拥有启动进程授予的系统权限。安装插件等价于
信任其源代码和依赖。微内核提供生命周期隔离，不提供进程级安全沙箱。

模型输出不可信。模型提供的工具参数必须经过：

```text
JSON Schema validation -> Policy decision -> optional Approval -> execute
```

默认工具注册表对以下情况失败关闭：

- 工具不存在；
- 输入不符合 Schema；
- Policy 拒绝；
- Policy 返回 `ask` 但没有 ApprovalService；
- 用户或非 TTY Approval 拒绝。

## 默认 Profile

默认权限模式是 `workspace-write`：

- 工作区内读取和写入允许；
- 工作区外读写拒绝；
- 外部和危险操作进入审批；
- Shell 总是标记为 `dangerous`；
- 非 TTY 审批默认拒绝。

工作区文件工具还独立执行真实路径校验，拒绝 `..` 和符号链接逃逸。即使 Policy 被
替换为 `danger-full-access`，`workspace-tools` 仍只操作工作区；需要更广能力时应提供
另一个明确命名的工具插件。

## 凭据

CredentialService 按请求返回凭据。默认环境变量插件不把值复制进 Profile、事件或
Session。禁止在以下位置记录 API key：

- System prompt 或 Agent message；
- Session event；
- 普通日志和 Telemetry；
- Tool details；
- 异常消息。

Provider 错误需要依赖上游 SDK 的脱敏，同时测试必须扫描 Session 和日志产物。

## Session

JSONL Session 文件包含用户输入、模型输出、工具参数和结果，可能包含敏感业务数据。
当前由操作系统文件权限保护，不提供加密。不要把 `.piharness/` 提交到版本库。

工具开始、结果和对应 ToolResult 通过可等待的 Runtime 订阅屏障增量提交。若进程在
`tool.started` 之后中断，恢复流程会生成失败 ToolResult 并标记旧 Run 失败，绝不
自动重放该工具。这个策略避免重复副作用，但不承诺“恰好一次”：工具可能已在外部
完成、只是结果尚未持久化。

附件 Blob 使用 SHA-256 内容寻址，Session 只保存引用。Context 请求时才把文本或
图片解析进模型消息。使用 CLI `--attach` 会把指定文件内容发送给所选模型 Provider；
这是显式的数据传输操作，调用者负责确认文件敏感性和 Provider 边界。

## Shell 与进程

Shell 使用工作区作为 cwd，设置超时并在中止时终止进程树。它不是命令级沙箱：
一旦批准，命令仍可能访问启动用户可访问的文件、网络和凭据。高保证部署必须在
容器、虚拟机或系统沙箱中运行整个 PiHarness 进程。

## MCP

MCP Server 是独立信任边界。发现到的工具不会直接交给 Runtime，而是注册进同一个
ToolService；默认风险是 `external`，因此默认 Policy 要求审批。stdio Server 是宿主
启动的本地代码，HTTP Server 会接收工具参数。只连接可信 Server，并在 Profile 中
显式配置每个连接。MCP 插件不默认启用。

## 供应链

- 直接依赖固定精确版本；
- lockfile 是解析依据；
- Provider 只按 Profile 动态加载；
- 未批准的依赖安装脚本保持禁用；
- CI 使用 `pnpm install --frozen-lockfile`；
- Pi 升级必须通过适配契约和 E2E。

## 尚未完成

- 插件签名和来源白名单；
- 进程级 Sandbox 插件；
- Session 静态加密；
- 网络域名 Policy；
- Windows Job Object/POSIX cgroup 级子进程保证。
