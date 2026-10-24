# 执行与验证

## 修改
- 原生首次健康等待从产品构建配置读取；Seal Harness 90000ms，上游缺省 30000ms。
- 配置读取校验 Node timer 的合法整数范围；不增加环境变量，不改变健康报告与恢复结果。
- Beta 完成后同步 Stable 的配置、原生入口与测试。
- 既有 macOS 窗口模拟测试在 Windows 返回反斜杠 preload 路径，修正测试为同时接受两种分隔符，未修改窗口实现。
- 更新桌面构建契约，保留来源、版本和现有 Profile 数据。

## 已完成验证
- Beta 相关回归 139 项通过；Stable 相同范围 139 项通过。
- 202 个共享源码文件对齐通过。
- 冷态测试子进程曾触发既有 5 秒测试截止并导致后续 mock 串扰；原阈值暖态重跑全部通过，没有调宽测试截止时间。
- 原预算 30 秒诊断重启在约 29 秒进入 healthy；这只说明当前环境可恢复，最终仍须用正式产品产物验证新增预算。

## 最终验收
- 全仓类型检查、产品完整构建及完整产品检查通过。Creator、插件管理器和两轮真实 Profile HMR 验证通过。
- 产品检查的既有 Electron 元信息案例曾触发 15 秒截止；独立实测 Stable 13.3 秒、Beta 21.4 秒均返回 resolver-ready。完整加载后按原 15 秒门禁重跑产品检查通过，未放宽测试截止。
- 正式编译产物的产品配置包含 rendererBootTimeoutMs: 90000；不再使用临时 180 秒诊断修改。
- Windows 原 desktop Profile、默认进程内 Host、无调试端口或安全模式启动成功。runId 为 df6da7e0-b005-4e7c-b91f-fc96ec6a27e5，Renderer 阶段耗时约 81.3 秒，2026-10-24 02:50:04 UTC 记录 startup.run.completed / rendererStatus: healthy；主窗口响应正常。该耗时确实超过原 30 秒，证明新预算覆盖了现场问题。
- 差异空白检查通过；只读上游子模块保持干净。原账号、工作区、会话和凭据未重置；未测试真实模型调用或其他操作系统的图形启动。
- 本轮未获代码提交、推送或发布授权，改动保留在当前分支待提交；不归档尚未提交的实现。

## 追加：浏览器 MCP 导致会话创建失败

- 用户复测发现 Renderer healthy 后仍无法创建会话。根因是 provider 用 Electron 的 process.execPath 运行 npm CLI，当前 rc.2 未包含旧 0.1.7 已有的 Node 模式兼容补丁。
- 同一 CLI 原始 Electron 模式约 6 秒后 Connection closed；局部 Node 标志后约 1 秒成功返回 24 个工具。新增 rc.2 版本补丁，只修改该 MCP 子进程 env；官方 tarball 与固定子模块不变。
- 根 resolution/lock 已更新，实际 Beta 安装文件含条件标志；用户 desktop Profile 没有覆盖该 provider，因此使用修复后的 Desktop 包。Yarn 安装、不可变安装、343 包来源校验及 202 个共享源码对齐通过。
- 完整产品检查已重跑通过，包括原有全部模块与新增 Electron standard 会话、24 个工具、Creator、插件管理和两轮 HMR。元信息案例仍使用原 15 秒阈值；冷态曾超时，最终原门禁通过。
- CJS 冒烟引导进一步隔离基础 DSH_HOME（产品 SQLite 不只取决于 Profile 目录），清除父进程的全局 Node 标志；更新后独立重跑 Profile 检查通过。真实账号数据库不作为测试夹具。
- 当前电脑缺少所需浏览器，已从 Playwright 官方固定源安装 Chrome for Testing 153.0.8010.12 / Chromium 1243，使用 --no-shell --no-remove 保留原缓存。原始归档 205123748 字节，MD5 ei09b8SO4hncRZArhJPUAQ== 与官方响应元信息一致。
- 实测相同 MCP CLI 打开 about:blank 成功并返回页面快照，navigationError=false；不是只检查工具列表。快照证据移到 .build/browser-mcp-validation/browser-snapshot.yml。
- 工具自动安全审查拒绝了临时下载归档/分段文件清理，仅返回 blocked by policy。未绕过策略，相关文件仍在忽略目录 .build/browser-runtime-download，不纳入提交。

## 登录后图形验收完成

- 用户已在应用完成本地登录；没有读取或重置账号密码。
- 实际点击首页“新会话”，原生输入界面可见，无 session create failed。
- 实际点击一级“问问决策”，捕获 /api/session/create 返回 HTTP 200，响应包含会话标识且无远端错误；决策页输入框可见，首页资源菜单按预期隐藏，无 session create failed。
- 测试期间 /api/session/prompt 请求数量为 0，没有发送模型提示词或生成测试回复。
- 应用保持登录并停在决策输入页，PID 283700（操作前须重新核对可执行路径），本次验证使用临时调试端口 9335。无需再次重启让用户重新登录。
- 本任务的代码、运行时和图形验收均已完成；所有改动仍未提交、未推送，等待后续提交授权。不重复实现或无依据重跑全部检查。
