# Seal Harness

基于当前仓库的 DSH Desktop，应用 ID 为 `com.seal-harness.desktop`，默认数据目录为 `~/.seal-harness`。显式 `DSH_HOME` 仍可覆盖。旧数据不会被自动搬移或删除。

首次启动会引导创建本地管理员账号；此后使用本地用户名和密码登录。登录状态仅保存在本次运行内，退出或重启后需要重新登录。用户、专家和技能存储在基础 Home 的 `seal-harness.sqlite`，基础 Home 中原有的本地技能与专家文件会在首次登录时复制导入，原文件保留。旧远端账号专属 Home 不会自动归属新本地账号。项目、知识库与产品智能体插件不再装配；普通对话及工作区继续使用 DSH 原生能力。图标仍为当前产品的小海豹。

```sh
git submodule update --init --recursive
git lfs pull
corepack yarn install --immutable
corepack yarn seal-harness:dev
```

使用根仓库要求的 Node 和 Yarn。首次启动若 Electron 尚未下载，在 `dsh-plugin-desktop-beta/` 执行 `node node_modules/electron/install.js`。

| 命令 | 用途 |
| --- | --- |
| `corepack yarn seal-harness:build` | 构建品牌插件和 Beta 桌面（DSH 0.1.7-alpha.2），装配产品资源，无图形启动 |
| `corepack yarn seal-harness:start` | 启动已经构建的Seal Harness |
| `corepack yarn seal-harness:dev` | 构建并启动Seal Harness |
| `corepack yarn seal-harness:check` | 检查品牌资源、客户端slot、真实Profile组合与更新隔离，先运行build |
| `corepack yarn seal-harness:package` | 当前平台、当前CPU架构的未签名解包应用，用于本机验证 |
| `corepack yarn seal-harness:dist:mac` | Intel / Apple Silicon通用DMG和ZIP |
| `corepack yarn seal-harness:dist:win` | Windows x64安装器和ZIP |
| `corepack yarn seal-harness:dist:linux` | Linux x64 AppImage和deb |

打包在目标操作系统执行，输出在本目录 `dist/`，不会发布。发行前仍须按根AGENTS运行 `corepack yarn aa:prepare-release` 并提交生成的依赖版本、来源和锁文件；dist命令验证其新鲜度。公开分发前另行配置公司签名及macOS公证。

上游 `build/dev` 命令保留原意。不带产品配置重新构建上游会清除Seal Harness产物，此后 `seal-harness:start` 会要求重新构建。两者共享编译目录，不要同时运行两种构建。

## 目录和扩展

- `product.json` 是产品身份的唯一来源。构建期注入使Host、子进程和原生窗口保持一致。
- `src/` 和 `cordis.patch.yml` 是标准Cordis品牌插件及bundle。这里的YAML是Loader配置，不是源码补丁。
- `assets/` 使用按 ip-as-logo 风格生成的小海豹图标，并通过 Git LFS 跟踪；`app-icon.png` 保留生成原图，各平台和托盘资源由它派生，来源及资源哈希见 `icon-provenance.json`。运行 `python scripts/export-product-icons.py` 可重新导出，需安装 Pillow。
- `scripts/` 复用上游安装的构建工具和打包检查，没有第二套依赖或锁文件。
- `plugins/local-data/` 负责同一个 SQLite 数据库、迁移和事务。`plugins/identity/` 负责本地账号认证；`plugins/experts/`、`plugins/skills/` 共用该库。既有项目表保留为历史数据，不再有产品项目插件读取它。
- `plugins/navigation/` 通过公开 Desktop slot 组合“首页、空间、定时任务”一级窄栏与首页二级菜单。专家、技能、连接器仍独立管理数据和生命周期；插件管理复用 DSH 原生主面板，但入口归入首页。空间复用 DSH 工作区，定时任务暂不执行后台调度。

构建仅在忽略目录中装配插件到 `dsh-plugin-desktop-beta/node_modules/seal-harness-desktop/`，资源到 `dsh-plugin-desktop-beta/lib/product-assets/`。安装包通过electron-builder的文件映射包含同一插件。上游源码、图标源文件及Harness子模块不会被构建脚本改写。

界面通过公开的sidebar和conversation品牌slot替换。启动身份、原生文案、图标路径及版本请求需要构建配置接缝。详见 [迁移说明](../docs/seal-harness/migration.md)。更新服务未配置，因此后台、手动检查及客户端更新按钮均禁用，不能安装社区DSH产品更新。

第三方包名、DSH Terminal、协议标识和许可证保留其原始名称。今后的业务功能按实际职责增加插件，使用服务、事件、slot和bundle组合，避免深度引用上游源码。
