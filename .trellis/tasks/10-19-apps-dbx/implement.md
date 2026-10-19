# 执行

1. 核对 DBX 官方包、数据目录与 MCP 协议。
2. 实现受校验安装器、账号 SQLite 状态及 connector Host 生命周期。
3. 实现应用页与首页导航、按钮生命周期，装配产品插件。
4. 失败回滚、账号隔离、真实 MCP 与 UI 验证，产品 build/check，记录结果。

## 2026-10-20 验证结果

- 产品完整 build 通过；后续应用插件调整已重新编译和装配。
- apps 的 11 项测试全部通过，包含真实官方 ZIP、MCP 握手、会话选择和真实 dbx_list_connections 调用（返回尚无连接，isError=false）。用户主动停用的连接器不会在重启恢复时被自动重新启用。
- local-data、identity、user、navigation、scheduled-tasks、store、connectors、skills、experts、capability-shared、session-context-selector 与 apps 回归全部通过；产品配置验证和 Profile/HMR 验证通过。
- Windows x64 Electron 真实页面确认菜单和完整按钮状态。安装后 25 个工具可见，无安装加号；打开真实 DBX 窗口；退出测试 DBX 后卸载恢复“＋ 安装”。物理 runtime 目录已删除，data 目录及 345 个数据/缓存文件保留。
- 实测发现 DBX 子进程可能在主进程退出后占用 cwd，GUI/MCP 的 cwd 与 WebView2 用户目录已改到保留的 data；删除增加有界重试。Windows 进程检测使用 Get-Process，避免旧 PowerShell CIM 启动超时。
- 默认进程内 Host 的界面曾健康启动，但调试期间出现启动缓慢/调试端口不响应；最终实机复测在显式 DSH_DESKTOP_ISOLATED_HOST=1 的隔离测试实例完成。没有改动产品默认 Host 模式，也没有重启/修改用户原有运行实例。
- `seal-harness:check` 在原有 `product.test.mjs` 的 Stable Electron 元信息测试被 15000ms 超时阻断，单独复核仍超时。该测试只读取原有上游实验插件，不加载本次 apps 模块；没有跳过后声称整轮门禁通过。其余门禁按原命令分别执行并通过。
- Windows ARM64 包已固定官方摘要，但未在 ARM64 设备测试。没有真实数据库连接，未执行外部数据库 SQL。安装缓存和 QA 产物都在忽略目录中。

功能已实现；完整门禁仍有上面的既有超时项，因此暂不归档任务。
