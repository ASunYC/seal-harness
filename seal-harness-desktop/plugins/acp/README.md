# Seal Harness ACP Runner

`@seal-harness/acp` 将外部 ACP v1 编程 Runner 接到 Seal Harness，提供独立一级页面及 `list_acp_runners` / `acp_runner` 模型工具。界面语义参考 Octop Enterprise 的 Runner 目录，代码独立实现，不复制其 Python 运行时或品牌资产。

## 使用

1. 在第三方产品的官方流程中安装并登录支持 ACP 的 CLI/adapter。预设提供 OpenCode、CodeBuddy、Claude Code、Codex、Kimi Code、Cursor CLI 和 Pi 的配置起点；不同版本的实际命令可能不同，可编辑。
2. 在 ACP 页点击“配置”或“添加 Runner”，填写可执行程序、JSON 参数数组及绝对工作目录。Windows `.cmd/.bat/.ps1` 入口不会通过 shell 执行；请改为真实可执行文件，或填写 `node.exe` 的绝对路径，并把 adapter 的实际 JS 入口放在参数中。不要填写整条 shell 命令。
3. 密钥放在“环境变量”JSON 对象中，使用 CLI 自己的变量名。旧环境值不回传；留空保留，填写对象替换全部，填写 `{}` 清空。参数属于普通可见配置，不能把密钥放在参数中。
4. 保存并启用后点击“检查”。检查会真实启动进程，执行 ACP initialize 与 session/new；程序存在不代表已通过协议或登录。插件不自动下载 adapter、不自动登录，也不调用模型执行测试任务。
5. “运行”会向 Runner 自己配置的模型服务发送任务，可能计费。可查看分段输出、停止任务；也可在 Seal 对话中通过 `acp_runner` 委派给已启用的 Runner。

默认拒绝所有 ACP 工具权限请求。用户可明确选择“自动选择每次请求的单次允许项”；该策略仅选择 `allow_once`，从不选择 `allow_always`。本插件不提供客户端文件系统/终端 RPC 能力，Runner 在自己的进程中工作；工作目录并不是操作系统沙箱。

## 存储与协议

- local-data v7 的 `acp_runners` 保存当前本地账号的名称、程序/参数、工作目录、超时、权限策略及启用状态；不另建数据库。
- 环境变量保存到 Host credentials 的账号独立 grant，公开 DTO 仅包含变量名。外部进程通过 DSH 公开 `ctx.subprocess` 启动；该服务清除环境中可疑凭据和 DSH 内部变量，再合并显式配置环境。CLI 自己的本机登录状态仍由它管理。
- 协议使用已安装的官方 `@agentclientprotocol/sdk@1.4.0`，依赖沿现有 Desktop 分发，许可 Apache-2.0。使用 stable ACP v1，不把普通 stdout 当作回答。非 ACP 程序、登录失败、协议错误、未知会话和提前退出都会明确失败。
- 每账号同一时刻最多一个检查/任务。检查最长 15 秒；任务超时为 5–3600 秒。输出最多保留 65536 字符，超出会标记截断；协议单帧最多 2 MiB，stderr 由 DSH 有界收集 4096 字节且不回传到页面。
- 禁用、修改、删除配置前先撤销并等待本 Runner 的旧进程；退出/切换账号或插件卸载也会取消活动工作。清理走 DSH 受管进程范围的 `terminate/waitForExit`；未能确认停止时保留占用，阻止新工作，不能伪报成功。
- 最近最多保留约 20 条本账号操作记录，仅在当前 Host 内存中保存；重启清空。结果可能包含第三方模型生成的项目内容，按当前账号隔离，不保存提示词至本模块数据库。

## RPC

POST `/api/seal-harness-acp/{action}` 使用已有 `client-request/server-response` envelope：

| action | payload | 结果 |
| --- | --- | --- |
| snapshot | `{}` | 预设/配置、程序发现、最近检查及本账号运行记录，不含环境值 |
| save | `{id?,name,config:{command,args,cwd,timeoutSeconds,permission},enabled?,environment?}` | `{id}` |
| toggle | `{id,enabled}` | `{id,enabled}`；停用会等待旧运行清理 |
| delete | `{id}` | `{deleted:true}`；不卸载 CLI |
| check | `{id}` | 真实 ACP 握手与新会话结果；不发提示词 |
| run | `{id,prompt}` | 接受后的运行记录，随后 snapshot 轮询输出 |
| cancel | `{id:runId}` | 等待清理后的运行记录 |

只接受 Host 当前账号，不接受客户端指定 owner。服务错误使用稳定 code 和简洁中文提示，不将原始协议/环境异常回传。配置修改带互斥标记，阻止 await 清理或凭据操作期间插入新的运行。

## 验证范围

模块测试使用真实 SDK Agent fixture 子进程，覆盖 initialize/session/new/prompt/update/cancel、单次权限与默认拒绝、超时、提前退出/非 ACP、输出限制、账号隔离、环境 scrub、配置并发与清理失败。另以真实 Cordis `LocalSubprocessRuntime` 验证 Windows 受管进程启动与取消，并覆盖 RPC/模型工具及页面配置、运行、停止、删除确认与晚到导航。

未使用用户真实第三方账号或付费模型验证七种 CLI。其安装、登录和不同版本的 ACP 兼容性以实际“检查”结果为准。macOS/Linux 上的真实 CLI 与安装包未实测。
