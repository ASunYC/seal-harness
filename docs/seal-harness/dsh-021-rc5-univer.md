# DSH 0.2.1-rc.5 与本机 Univer Office

## 范围与来源

以下记录 2026-11-02 的首次本机升级与安装；2026-11-03 的后续修复和提交检查见文末补充。

本轮将 Seal Harness 活动 Beta 内核从 0.2.1-rc.2 升级到官方最新发布的 0.2.1-rc.5，固定子模块提交为 `b830ec950faba0a46dda564be3e2d854afed94f1`。未选择较早发布的 0.2.2-alpha.2 实验线，未修改子模块源码。Stable 的 0.2.0-rc.2、Next 的 0.1.7-alpha.2 和 Seal 产品版本 0.1.0 保留；窗口显示的内核版本自动更新为 0.2.1-rc.5。

- 上游发布：<https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5>
- Office 插件：<https://github.com/dream-num/dsh-univer-office>，本机安装固定 npm 版本 0.3.9。
- 344 个官方 npm 原始包存入 `vendor/dsh-runtime/0.2.1-rc.5/`，清单记录提交、npm SRI、大小和 SHA256。
- 24 份既有叶子补丁移植到新版本；会话 UI 补丁重新生成，仅保留三个 Desktop DOM 标记，保留上游新增菜单。
- AA 源码仍为 `7fe1fce32650483bf8433f7a198032178580ff16`，仅重建接受新版内核的桥接产物。新产物 SHA256 为 `6634049c7c99dd1a199091dbc57e6e5872594deccad5d2d6b0e7324936598a5b`。

## 数据保护与安装边界

升级前，本机 SQLite 一致性备份及非依赖 Profile/Home 配置保存在忽略目录 `.build/dsh-rc5-backup-20261102-000759`；数据库完整性检查通过。未重置账号、会话或工作区，未输出密钥。

Office 是用户授权安装到实际 `~/.seal-harness/profiles/desktop` 的第三方插件，不是产品默认依赖，不修改根工作区布局。显式 `DSH_HOME` 仍优先。通过 Desktop CLI 的公开 `plugin --profile desktop add` 安装，使用随 Desktop 的 pnpm 脚本绝对路径、固定版本和官方 npm registry。保持 Profile 的 `autoInstallPeers: false`，避免安装另一套 DSH Host。禁用插件匿名遥测。

首次下载两个大包遇到网络超时，重试只延长本次 pnpm 网络截止时间并复用缓存，没有放宽应用启动或测试门禁。AA 隔离依赖准备也曾遇到默认 registry 网络失败，改用进程级官方 npm registry 后，构建、类型、产物校验通过。

## 验证

- 根不可变安装通过；344 个运行时包、24 份补丁及 202 份共享 Desktop 源码一致性通过。
- 完整产品构建和 `seal-harness:check` 通过，包括真实 Electron standard 会话的 24 个浏览器 MCP 工具、Creator、插件管理器和两轮 Profile HMR。
- Stable、Beta、Market、Next 类型检查通过。新版侧栏声明引入 analytics 类型引用，为 Market 补充对应开发依赖；没有启用遥测。
- Beta 启动健康、产品配置和网络回归 29 项通过；Stable/Beta 旧会话持久化迁移各 1 项通过。
- 额外 `check:layout` 被已有 README 双语哈希记录过期阻断：记录中文 blob `81c5e4d...`，实际为 `141d86cc...`。这三个 README 文件本轮无改动；未通过重录哈希冒充翻译核对。

Office 安装后，在真实 Electron Host 的隔离工作区验证了 14 个 Office 工具；创建 `.univer` 和草稿工作树，创建 Sheet，写入文本和数字，结构化读回，再导出 `.xlsx`。另行校验导出 ZIP 完整性、工作簿/工作表 XML 和测试文本。带有效浏览器 cookie 与会话作用域的 Viewer 返回 HTTP 200 和真实 HTML；缺少身份/会话参数的请求仍被拒绝。最初测试直接导入实际 Profile 之外的包，缺少 Loader 解析归属；改为通过实际 Profile 的公开解析入口加载后通过，未修改产品解析策略。

实际用户 Profile 图形启动成功，保留 admin 登录、原有工作区及历史会话；客户端启动清单包含 `dsh-univer-office`，没有恢复页或界面错误。通过实际已认证页面启动 Office Gateway，接口返回 HTTP 200、`phase: running`；Viewer runtime-config 返回 HTTP 200。没有发送付费模型消息。服务默认延迟启动，初始 `stopped` 不代表安装失败。

首次安装仅在本机 Windows 验证，未声称 macOS/Linux、安装器、签名或发布验证通过。

## 2026-11-03 提交前补充

- 内核 pin 已单独提交为 `53399025`；运行依赖、原生 ABI、CLI 与后续回归修复也已分别形成提交，未改写上游子模块源码。
- README 中英文内容及双语记录已在 `cec3bbf3` 对照修复，前述初次检查的 README 阻塞已经解除。本次导航文案构建、导航客户端回归和完整 `check:layout` 均通过。
- 一级导航“首页”改为“办公”，按钮无障碍名称、悬停提示及空间页引导同步调整；不改变导航标识或会话行为。
- 其他已提交修复的完整产品检查、Market 检查及 Linux 定向验证见 `.trellis/tasks/11-03-bundled-office/implement.md`。Windows 完整回归仍有符号链接权限等环境限制，Linux 完整依赖安装未完成，不能将定向通过写成全平台完整门禁通过。
- 用户已授权提交并推送线上 `main`。本次只同步源代码及已有官方 DSH 运行时归档，不生成安装器或发布 Release；不包含本机账号、凭据、数据库、Profile 依赖目录或真实 Univer Pro 安装包。
