# 完成审计

审计日期：2026-08-25

本文件按 [`development-plan.md`](development-plan.md) 的 M0–M7 逐项核对当前证据。
结论：本地实现与发布准备完成；GitHub 空仓库创建、`origin`、首次 push 和远端 CI
尚未完成，因此整个用户目标不能标记为完成。

## M0：仓库与决策基线

| 要求 | 证据 | 状态 |
|---|---|---|
| 本地 Git 仓库 | `main` 上存在完整 Conventional Commit 历史，工作区 clean | 完成 |
| GitHub 私有仓库 | GitHub 连接搜索 `PiHarness` 返回空；浏览器创建表单等待最终确认 | **未完成** |
| Node/pnpm workspace | 根 manifest、lockfile、25 个可发布包 | 完成 |
| 架构与 ADR | `architecture.md`、ADR-0001 | 完成 |
| CI 基线 | Node 22.19/24、pack smoke workflow 已定义 | 本地完成，远端未运行 |

## M1：插件微内核

- Kernel 包没有 runtime dependencies。
- 测试覆盖稳定拓扑、可选依赖、事件顺序、LIFO Effect、逆序卸载、启动回滚、缺失/
  重复服务、循环依赖和非法服务发布。
- clean build 后 Node ESM import 成功。

状态：完成。

## M2：领域契约与替身

- `@piharness/core` 提供 Runtime、Model、Session、Tool、Policy、Approval、Context、
  Compaction、Attachment、Credential 和 Telemetry 契约及 branded IDs。
- Memory Session、Scripted Model、Scripted Runtime 均为独立插件。
- Scripted Runtime Profile 不注册 Pi 或 ModelService 仍完成 Agent/Session 全流程。
- ToolService 测试证明未通过 Policy 不会执行。

状态：完成。

## M3：Pi 适配层

- `runtime-pi` 包装真实 `@earendil-works/pi-agent-core` Agent。
- `provider-pi-ai` 按 Profile 动态加载 Provider。
- 契约测试覆盖文本、Provider error、Abort、Steering、Follow-up、单/并行工具、工具错误
  恢复及签名 round-trip。
- 凭据测试证明 secret 到达 Provider 边界但不进入规范化事件。
- Pi 类型只出现在两个 Pi adapter 包和其测试中。

状态：完成。

## M4：Headless Agent

- JSONL Session、Context、工作区工具、Policy/Approval、Credential、CLI 和默认 Profile
  已组合。
- 临时仓库 E2E 经真实 Pi loop 完成 read → edit → shell verify → final response。
- 工作区外路径拒绝；Linux CI 将额外运行 symlink escape 测试。
- Shell Abort/timeout 终止进程树；非 TTY Approval 失败关闭。

状态：完成。

## M5：恢复与上下文

- Session resume/fork、JSONL 单行事务、SQLite 事务、物理格式版本和异常尾行恢复。
- Runtime awaited subscription 形成持久化屏障。
- 中断工具生成失败 ToolResult，明确不自动重放。
- Compaction 事件可重放；真实 Pi loop 长历史 E2E 在压缩后继续完成。
- 内容寻址附件在 Session 保存引用、请求时解析。
- ToolService 对任意插件结果实施统一字节截断。
- 故障注入覆盖模型流、工具执行和 Session 写入。

状态：完成。

## M6：可选生态

- Filesystem Skills、官方 SDK MCP Client、SQLite Session、JSONL RPC、No-op Telemetry。
- MCP 使用真实官方 SDK Client/Server 的 in-memory integration test。
- 编译后 RPC 进程 smoke 输出严格 JSONL。
- No-op Telemetry 测试证明不调用 `fetch`。
- 最小离线 Profile 不加载这些能力仍可运行。

状态：完成。

## M7：发布准备

- 用户、插件、API、安全、Session、MCP、版本、贡献和 Changelog 文档齐备。
- Dependabot、CI 和手动 Release Candidate workflow 已定义。
- `pack:smoke` 校验统一版本、精确直接依赖和 tarball 内容白名单。
- 25 个包从 tarball 安装到全新临时目录，打包后的 CLI + Scripted Pi Agent 运行成功。
- `pnpm audit --prod`：0 个已知漏洞。

状态：本地完成；远端 workflow 未运行。

## 最新本地验证

```text
pnpm check       27 test files; 72 passed; 1 Windows-conditional skip
pnpm audit --prod  No known vulnerabilities found
pnpm pack:smoke  Packed 25 packages and verified a clean install
```

## 唯一剩余外部条件

1. 在 GitHub 账户 `ASunYC` 创建私有空仓库 `PiHarness`；
2. 配置本地 `origin`；
3. 首次 push `main`；
4. 等待并核对 GitHub Actions；
5. 确认本地/远端 commit 一致。

浏览器安全策略要求在点击最终“Create repository”前获得即时确认。用户确认后即可继续，
无需新的技术决策。
