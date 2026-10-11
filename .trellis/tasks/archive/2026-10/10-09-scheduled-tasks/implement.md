# 执行顺序

1. [x] SQLite v3、时间计算与任务/记录服务，验证迁移和账号隔离。
2. [x] 公开会话接口的执行适配、重复与重叠防护、取消/超时/关闭处理。
3. [x] 定时任务页面及原生会话跳转，接入现有产品装配。
4. [x] 回归测试、产品 build/check、审查 diff 和更新契约。

执行采用 inline；不运行自动提交的 journal/archive 脚本。完成后保留 task 和全部源码变更供用户审阅。

验证结果（2026-10-09）：使用本机 Node 24.19.0 与根 Yarn 4.18.0。`corepack yarn seal-harness:build` 通过；最终调度/页面修正后重新编译并装配产品插件，`corepack yarn seal-harness:check` 通过（163 项，161 passed、2 个现有平台条件 skipped、0 failed），包括实际 Profile 激活与两代 HMR。之后新增的 Client 跳转测试单独通过。定时任务新增 13 项测试全部通过；`git diff --check` 通过。

未运行真实模型调用、真实 Electron 窗口点击、macOS/Linux 安装/升级。RPC 和执行结果测试使用受控 Session Controller，不宣称远端模型验收。所有修改未提交；HEAD 仍为 a64e734，等待用户审阅。

2026-10-10：用户明确授权按功能提交并推送主分支；本功能 ae53d58041ffea7096b6b46dd1f87eb8fd4beaac 已推送 origin/main，任务归档完成。
