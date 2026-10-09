# 执行计划

依据 `design.md` 的分层结论。每阶段独立可验证，完成后提交。

## 阶段 0：能力矩阵落盘 ✅ 已完成

- [x] 实测 `dsh-base` / `dsh-web-app` 的装配清单，得到 25 / 6 / 9 / 0 分层
- [x] 确认依赖解析机制（`resolutions` → `file:vendor/...`，1148 条）
- [x] 确认官方 `OPTIONAL_BUNDLES` 仅两项
- [x] 发现 `session-query-sqlite` 的 `openAt: never` 配置级关闭
- [x] 产物写入本任务 `design.md` 与 `docs/seal-harness/cc-haha-plugin-migration.md`

## 阶段 1：装配已安装未装配的 6 项

优先补 Host 侧缺失，因为 UI 已在，补上即可能立即可见。

1. `dsh-terminal`（终端 Host）— 终端 UI 已装配
2. `dsh-mcp-client`（MCP Host）— 资源已装配
3. `dsh-workflow`（工作流 Host）— 工具与 UI 已装配
4. `dsh-tool-ask-user`（提问工具）— 提问 UI 已装配
5. `dsh-experimental-agent-team`（AgentTeams Host）— 需与阶段 2 一并考虑
6. `dsh-experimental-speech-to-text` — 建议改用整个 `voice-input-bundle`

**验证**：每项 insert 后跑 `seal-harness:build` + `seal-harness:check`，并在隔离 `DSH_HOME` 的真实窗口确认。分 2–3 批提交。

## 阶段 2：启用自带 bundle（一次一组成套能力）

1. `dsh-experimental-agent-team-profile` — 一次得到 Host + 工具 + UI 三件套
2. `dsh-experimental-voice-input-bundle` — 一次得到 STT + SenseVoice + API + UI

这两项是官方设计好的「成套开关」，成本最低、收益最直观。

## 阶段 3：覆盖配置级关闭

- `session-query-sqlite` 从 `openAt: never` 改为按需开启，使全局搜索可用
- 确认 Token 计量与会话统计的实际可见入口

## 阶段 4：补依赖后装配（**已修正：非单行装配**）

原计划单行 insert 5 个包。实测后该计划不成立，见 `design.md` 第七节：
两个「接口」包各自只导出空 registry（0 工具），而两个 runtime 实现都以
`dsh-mcp-client` 为 peer 依赖，三个浏览器驱动各带未安装的外部 npm 包。

正确顺序：
1. 装配 `dsh-mcp-client` 框架层（此前误判为「MCP 设置功能」而搁置）
2. 选一个浏览器驱动（建议 `playwright-mcp`，跨平台性最好），评估外部依赖体积
3. 接 `dsh-browser-use` + `dsh-experimental-browser-use-runtime`
4. Computer Use 单独评估：需确认 `@trycua/cua-driver` 许可与跨平台能力

## 阶段 5：独有能力产品插件

按 `docs/seal-harness/cc-haha-plugin-migration.md` 的阶段 2 / 阶段 3 推进（UI 自建、自建 Host 服务、宠物与远程访问）。

## 验证边界

- 每阶段结束记录实测范围到 `docs/seal-harness/validation.md`
- 未在真实窗口确认的项目不得记入通过
- macOS/Linux 留待目标平台单独验证

## 进度

- 阶段 0 完成：产出 25 / 6 / 9 / 0 分层，修正初版误判。
- 阶段 1 完成并提交（`d450ea4`）：8 行官方能力装配，修正门禁单复数漏报。
- 阶段 3 完成并提交（`a8548fa`）：会话全文搜索。
- 阶段 4 Browser Use 已实装（待提交）：`dsh-browser-use` + `dsh-experimental-browser-use-playwright-mcp`（2 行 insert），`@playwright/mcp@0.0.80` 从 npm 安装（17.87 MiB）。`mcp-client` 无需框架层行（设计修正见 `design.md` 第七节）。Chromium 二进制需手动 `playwright install chromium`。
- Computer Use（`dsh-computer-use` + `cua-driver-native`）、其余浏览器驱动（stagehand / chrome-devtools）待单独评估。
- 阶段 2（Agent Teams）待用户决策；阶段 5 未启动。

## 已知工具陷阱

`seal-harness:check` 从**装配副本**读产品 patch，不自动 build。改了
`seal-harness-desktop/cordis.patch.yml` 而忘记 build 时，check 会验证旧副本并
静默通过。本轮已实际触发一次假通过。固定做法：改 patch → build → check →
**再核对组合后配置确实变化**（用 `composeEntries` 打印目标 id 的 config）。
