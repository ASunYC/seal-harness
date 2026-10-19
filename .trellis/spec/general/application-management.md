# 本机应用管理

`@seal-harness/apps` 在首页资源列表注册 `apps` 二级菜单。首版固定 DBX Windows x64/ARM64 便携版 0.6.48 与 MCP 0.4.124，不接受客户端提供任意下载地址或可执行文件路径。

## 存储和路径

共用产品 SQLite，v4 新增 application_installations，主键为 user_id/app_id，保存阶段与安装 manifest。程序位于基础 Home 的 applications/<账号 SHA-256>/dbx/runtime，DBX_DATA_DIR 固定到相邻 data；data 不由卸载删除。缓存只保存摘要校验通过的公开发布包，可跨本机账号复用，不包含连接配置和凭据。ZIP 路径、符号链接、重复文件、文件数量与压缩/解压大小必须校验；程序启动前重新验证 exe 哈希。递归删除只允许命名安装根目录内的子项，拒绝 junction、symlink 和越界路径。

## 状态和 RPC

POST /api/seal-harness-apps/{list,install,open,uninstall,reconnect} 使用标准 client-request/server-response envelope。list 接收空对象，其余只接受 `{ id: 'dbx' }`。所有操作要求当前本地账号；长操作返回 accepted，界面轮询 list。安装中显示进度和禁用操作；安装完成隐藏“＋ 安装”，显示打开/卸载；成功卸载后恢复安装按钮。MCP 失败时必须区分“应用已安装”和“MCP 未就绪”，提供重连。中断操作保留可重试状态，不能伪报完成。

## MCP 和卸载

connectors 的 registerApplication/removeApplication 只存在于 hostHandlers，不暴露网络路由。必须校验 expectedAccountId，创建 ownerAccountId 与 managedApplication=dbx，复用现有 MCP 子插件、会话选择和工具权限隔离。应用界面和聊天工具 open_installed_application 只启动受校验的固定 DBX.exe。用户在会话选择 DBX 后工具才可调用；数据库连接和 MCP allowlist 由 DBX 自身管理。新目录使用默认只读兼容配置，不覆盖用户随后保存的 DBX 中央策略。

重启恢复不重新启用用户手动停用的 DBX 连接器；自动登记与手动重连均保留用户设置的 enabledTools 限制。

卸载先断开并删除本账号的 DBX MCP，再清理二进制和 SQLite 安装状态。DBX 仍运行或文件锁定时明确提示退出并允许重试，保留安装状态；不自动终止用户数据库操作。卸载产品插件时清理请求、安装任务和订阅；不自动删除已安装的外部应用或连接配置。

Windows 启动 GUI 和 MCP 的 cwd 必须使用保留的 data，WebView2 的用户目录也放在 data/webview。子进程继承 runtime 目录作为 cwd 时，即使主程序已退出，也可能导致卸载 rmdir 返回 EBUSY；删除使用有界重试处理短时文件锁。DBX 是单实例应用，打开前核对其他 DBX 的可执行路径；不同安装或账号的 DBX 正在运行时提示退出，防止焦点跳到错误数据目录的窗口。

## 必需检查

安装/打开/卸载/重装、MCP 失败重连、校验失败回滚、账号切换、数据库迁移、按钮无加号/恢复加号、ZIP 与删除边界；使用真实官方包验证 MCP 握手和原生会话工具调用及卸载清理。产品 build/check 和实际窗口核对；Windows x64 验证不代表 ARM64/macOS/Linux 安装已测。
