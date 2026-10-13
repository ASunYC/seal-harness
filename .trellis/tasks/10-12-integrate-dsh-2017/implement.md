# 实施顺序

1. 校验最新上游和 DeepSeek Harness commit 可取，盘点共享文件、包版本、产品接缝及 vendor 来源。
2. 移植和验证旧 Profile 清理安全修复，作为首个可独立提交的阶段。
3. 准备新内核 tarball 与锁文件；单独提交子模块 pin 和来源，再适配 Beta/Stable Desktop 运行时。
4. 集成插件包服务和产品插件兼容修改；逐层运行测试并修复。
5. 处理其他平台修复与包配置；完整验证、文档和本地提交。

实施结果（2026-10-13）：

- 已提交 Windows 旧 Profile 链接投影安全修复 `3c778c6a`；Stable/Beta 对应测试均通过。
- 已单独提交 Beta 内核 pin `d743267`、官方 `0.2.1-alpha.2` 运行时和锁文件 `218d923d`。
- 已提交 Stable `0.2.0-rc.2` 的官方运行时、补丁、锁文件和同时兼容两个内核的 Agents Anywhere `2.0.3` 构建 `08e37733`。官方运行时包和 AA tarball 哈希验证通过。
- 已提交 Stable/Beta 官方插件包服务、ProfileContext 和恢复模式包管理适配 `4501abc3`，并保持 201 个共享 Desktop 源文件一致。
- Stable/Beta 的 ProfileContext、官方插件包服务、CLI 恢复卸载和产品插件依赖已适配。Next 实验壳保持 0.1.7 独立 pin，通过共享语言类型声明维持类型边界。
- `corepack yarn install --immutable`、`corepack yarn typecheck`、`corepack yarn check:layout`、`corepack yarn seal-harness:build`、`corepack yarn seal-harness:check` 均通过。Stable/Beta 的 AA 启用 Profile 与两轮 HMR 通过；插件包和恢复卸载定向测试通过。
- Windows 图形应用在最终产品构建后健康启动，主窗口响应正常。第一次升级冷启动曾超时，后续启动成功；未进行签名安装、覆盖升级或 macOS/Linux 图形实测。真实模型回复需在用户现有凭据下验收。
- Stable 全量 Vitest 本机结果为 1559 通过、28 失败、13 跳过；剩余失败主要涉及本机无文件符号链接权限、Linux 工件测试、浏览器辅助进程超时及部分原生窗口断言。它们不作为跨平台通过的证据；定向产品与新插件服务门禁结果以上述通过项为准。
