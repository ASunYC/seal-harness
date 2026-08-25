# PiHarness 开发计划

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
- `@piharness/kernel` 构建产物可被 Node ESM 导入；
- 包的 `dependencies` 为空。

## M2：领域契约与测试替身

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
- Pi 消息、工具、用量、错误与 PiHarness 契约的双向转换；
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

## 全程约束

- 默认 Profile 每增加一个运行时依赖都必须说明能力收益；
- 公共插件 API 变更必须更新契约测试和迁移说明；
- 不通过 `runtime-pi` / `provider-pi-ai` 泄漏 Pi 专有类型；
- 不以 Mock 通过替代真实 Pi E2E；Mock 只负责确定性测试；
- 不以单元测试替代安全、恢复和发布范围的验收证据。
