# Seal Harness 迁移验证

此文件只记录 2026-09-29 本次迁移对当前源码的检查。用户提供 ZIP 中的旧产品验收记录不视为 Seal Harness 的验证结果。

| 检查 | 结果 |
| --- | --- |
| ZIP 条目路径检查与源码展开 | 通过：2908 个文件，未发现路径越界或内嵌 `.git` |
| 新海豹图标格式与 provenance SHA256 | 通过：19 个资源哈希一致 |
| Yarn 4.18.0 / Node 24 | 通过；使用本机捆绑 Node 24 运行 Corepack |
| `yarn install --immutable` | 通过；原 ZIP 锁文件与依赖声明不一致，已由 Yarn 4 更新后重跑 |
| `seal-harness:build` | 通过；11 个产品业务插件和 Beta Desktop 已编译、装配 |
| `seal-harness:check` | 通过；产品配置、图标、Host/Client、项目、专家及 Profile 启动验证完成 |
| `check:layout` | 通过；双桌面变体、固定运行时、上游图标、双语文档和子模块布局一致 |
| `typecheck` | 通过；根工作区各 TypeScript 包检查完成 |
| `git lfs fsck` | 通过；19 个产品图标资源由 LFS 跟踪 |
| `git diff --cached --check` | 通过；旧 `_deprecated/` 补丁档案未迁入 |
| Windows/macOS/Linux 原生安装、图形启动、签名与升级 | 未执行；本机仅完成 headless 构建与测试 |

Windows 上有一个连接器测试夹具使用 POSIX shell 可执行文件，已按平台明确跳过；连接器其余测试通过。来源工程的 Geovis 和内网服务在 Seal Harness 中默认不连接，实际远端业务仍须在授权服务环境分别验证。未推送或发布。

## 2026-09-30 更新目录整合

从更新的来源目录整合资源页同步、连接器、会话技能选择、会话删除和默认工作区路径。`yarn install --immutable`、`seal-harness:build`、`seal-harness:check`、`check:layout` 与 `git lfs fsck` 已通过。产品检查包含 59 个根 Vitest 文件、1205 个用例，以及 project-agent 的 5 个用例；Profile 重复装配和启动检查也通过。一个连接器 POSIX shell 夹具仍按平台在 Windows 跳过。

根 `typecheck` 已通过，`git diff --check` 和 `git lfs fsck` 也通过；固定 `deepseek-harness` 子模块未改动。真实 Electron 窗口视觉检查、原生安装、签名和升级未执行，不能归入上述通过结果。源工程的个人截图路径与旧产品图标没有迁入，当前所有产品图标仍来自 Seal Harness 小海豹原图。

## 2026-09-30 本地登录与 SQLite 改造

`seal-harness:build`、`seal-harness:check`、根 `check:layout`、根 `typecheck`、`git lfs fsck` 和 Git 差异空白检查均通过。产品检查包括本地账号、数据库迁移、项目按用户 CRUD、专家版本恢复、技能缓存重建、连接器与技能联动、资源页交互，以及实际 Cordis Profile 启动与两代 HMR。产品 Profile 报告 9 个业务插件，未装配知识库及产品智能体；原生 Agent 可用。额外验证了本地登录令牌不会发送至远端能力仓库。

仅在 Windows 上完成无图形构建和测试。没有做真实 Electron 窗口视觉检查、模型回复、安装包、签名、升级或 macOS/Linux 验证。原产品账号专属 Home 和远端项目清单未自动导入，新本地账号先从空项目清单开始。旧基础 Home 的技能、专家文件导入由定向测试验证，原文件保留。

## 2026-10-01 移除项目插件

根据用户请求，删除产品项目插件的 Host、Client、样式、包声明及测试，并从 `productPlugins`、Cordis Profile 和安装包装配中移除。构建脚本清理旧装配目录 `@seal-harness/projects`，不删除用户工作目录、原生会话或 SQLite 历史项目记录。

`seal-harness:build`、`seal-harness:check` 与根 `check:layout` 通过；Profile 验证报告 8 个业务插件。装配目录确认没有项目包。此前有关项目页的测试结果仅为历史记录，不代表当前版本仍提供项目菜单。

## 2026-10-01 远程控制弹窗品牌文案

Stable/Beta 的原生远程控制确认文案已改为读取自定义产品名。两个变体各 11 项相关测试、各自类型检查、`check:desktop-variants`、`seal-harness:build` 和 `seal-harness:check` 通过。测试确认 Seal Harness 构建的中英文主文案与说明使用产品名，无自定义配置时仍显示原上游名称。尚未在真实远程控制弹窗中执行点击验收。

## 2026-10-01 两级导航与首页

新增 `@seal-harness/navigation` 产品插件。一级窄栏保留对话并新增首页、空间、定时任务；首页二级菜单组合专家、技能和连接器。空间复用已有 DSH 工作区；定时任务仅显示明确空态。产品 `seal-harness:build`、`seal-harness:check` 通过，Profile 报告 9 个业务插件。导航状态、资源插件注册与卸载、实际 Client 渲染的定向测试通过。

在 Windows 兼容模式、隔离 `DSH_HOME` 的真实 Electron 窗口中，以本地测试账号验证一级与二级切换、专家子页、空间列表、定时任务空态、返回原生对话及输入框；深色、浅色和 760px 窄窗口截图分别核对。未执行 macOS/Linux 原生窗口、安装包及定时任务运行验收。启动时仍会出现上游 DeepSeek Harness 的内测声明，本任务未改其来源文案。

后续入口检查发现会话输入框的三个管理快捷入口仍使用旧资源面板 ID；已改为先选择首页内的资源，再打开首页主面板。定向 7 项测试、产品重建及完整产品检查通过；首页资源插件不再注册平铺一级入口。真实 Windows 兼容模式中再次验证首页包含三项二级资源。

## 2026-10-02 首页二级插件管理修正

按用户纠正移除一级“对话”图标，并将原生插件管理入口放进首页二级菜单，与专家、技能、连接器并列。原生插件管理主面板和新会话保持原功能；旧侧栏插件行仅隐藏显示，不移除 DSH 插件管理服务。Windows 兼容模式实测：首页概览四张卡、插件页及从插件切回专家、一级首页选中状态与旧行隐藏均正常。760px 窄视口的插件页顶部提供紧凑切换栏，标题和操作按钮无遮挡。产品构建、定向测试、`seal-harness:check` 通过。

## 2026-10-05 首页改为直接菜单

按用户再次纠正，删除首页概览入口、介绍语和资源卡片。一级仍为首页、空间、定时任务；首页二级菜单直接列出会话、专家、技能、连接器、插件。会话进入原生 DSH 聊天面板，资源返回按钮也回到聊天面板。Windows 兼容模式下以隔离数据目录的测试账号实测：会话 → 专家 → 会话及会话 → 插件 → 会话，菜单顺序、一级选中状态、原生输入框均正确。`seal-harness:build`、`seal-harness:check`、`check:layout` 通过。前节中的概览卡片是当时版本的历史验证结果，现已删除。
