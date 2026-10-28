# ACP 实现与验证

## 实现边界

实现位于 `seal-harness-desktop/plugins/acp/`，没有修改共享构建/Profile/导航/数据库或上游源码。local-data v7 使用父智能体提供的 `acp_runners` 表。Host 依赖 `connection/sealHarnessDatabase/sealHarnessIdentity/credentials/subprocess/tools`，提供 `sealHarnessAcp`。Client 通过导航服务注册 `id=acp/order=130/primary=true/icon=acp`，支持导航服务晚到和卸载。

## 协议与生命周期

- 官方 SDK 1.4.0 的 ACP v1 客户端，配合公开 `ctx.subprocess.resolveExecutable/spawn/terminate/waitForExit`。不装配 ACP 服务端冒充外部 Runner 客户端，不导入只读上游内部 transport。
- initialize → session/new → session/prompt，消费 agent_message_chunk，停止通过 session/cancel 与受管范围清理。不给外部 Runner 客户端 fs/terminal 能力。权限默认拒绝，可显式选择每次请求的 allow_once，绝不选 allow_always。
- lookup/工作目录读取/凭据读取/请求等待均受取消约束；外部查找使用显式环境和 AbortSignal。Windows脚本入口明确 unsupported，提示 Node+实际JS路径，不拼 shell。
- mutation 标记在任何 await 前置位；配置修改、停用、删除期间拒绝并发 run/check。清理失败保留 jobs 占用，禁止继续启动或修改，保留未知停止状态。
- 账号与 epoch 检查贯穿异步流程，旧输出不向其他账号暴露；环境值只在 credentials，配置/列表不返回秘密。

## 测试

测试文件：`tests/service.test.mjs`、`host.test.mjs`、`client.test.mjs`；fixture 使用官方 SDK Agent 与真实 stdio 子进程，不发送真实第三方模型请求。包括：

1. 真实 Cordis LocalSubprocessRuntime + SDK fixture：握手、新会话、流文本、取消及进程清理。
2. 配置持久化形状、账号隔离、拒绝未登录/跨账号、输入与保留环境变量校验。
3. SDK 子进程完整执行、退出确认、默认拒绝/allow_once、64K输出截断。
4. 公共 subprocess 环境 scrub 与显式环境转发。
5. 实际进程取消、5秒超时、停用及账号切换清理。
6. 无效协议/程序不存在不报告 ready。
7. mutation await 并发窗口、清理失败阻止新工作、挂起 lookup 可立即取消。
8. RPC envelope、模型工具走同一真实协议路径、页面配置/检查/运行/停止/删除确认、旧环境值不显露、晚到导航。

测试过程中修复了遗留 active 判断、stderr 非法 disposition、取消未覆盖 lookup、显式 PATH 被忽略四项问题；stderr 当前为 `{maxBytes:4096}`，并有契约断言和真实 runtime 回归。

第三方 CLI 各自的安装/登录/付费模型兼容性以及 macOS/Linux 图形安装未测；只将程序发现与本地受控协议测试作为已验证事项，不宣称七个供应商均真实连通。

最终执行 `node --test plugins/acp/tests/{service,host,client}.test.mjs` 等价三个明确路径，14 项全部通过、0 失败（11项服务/协议 + 1项RPC/模型工具 + 2项页面/导航），其中额外覆盖显式 PATH 查找与 stdout 读取错误仍能清理真实子进程。`git diff --check` 通过。模块 Host/Client 已定向编译；完整产品重建/检查由主智能体统一执行，没有提交或推送。
