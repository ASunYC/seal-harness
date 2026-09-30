# Seal Harness 桌面构建契约

## 工程边界

根仓库直接继承 DSH Desktop；`deepseek-harness/` 是只读的固定提交子模块。产品身份、海豹图标、插件、bundle、Profile 与构建接入归 `seal-harness-desktop/`。它不是根 Yarn workspace，不安装第二套 DSH 运行时或创建第二份锁文件。优先使用上游公开服务、事件、slot 和插件组合。共享 Desktop 代码确需修改时，按根 `AGENTS.md` 执行 Beta 先行与双变体验证。

Node 要求 `^22.19.0 || >=24.0.0`，根 Yarn 固定 `4.18.0`。使用 `corepack yarn seal-harness:build` 编译产品插件并装配 Beta Desktop；`seal-harness:check` 是无图形产品验证入口；`seal-harness:start` 显式启动图形应用；各 `seal-harness:dist:*` 在目标操作系统打包。上游 `build` 与产品 `seal-harness:build` 共享编译目录，不并行运行。发布前仍按根发布流程准备 Agents Anywhere 产物，签名和跨平台安装分别实测。

`product.json` 是产品名、应用 ID、数据目录与更新渠道的来源。名称是 Seal Harness，应用 ID 是 `com.seal-harness.desktop`，默认 Home 是 `~/.seal-harness`；显式 `DSH_HOME` 覆盖保留。社区 DSH 更新渠道不得作用于产品。海豹图标原图和派生资源由 `assets/`、`icon-provenance.json` 和 `scripts/export-product-icons.py` 管理；保留 Git LFS 与来源记录。构建产物不入库。

## 当前插件组合

构建顺序由 `seal-harness-desktop/scripts/build.mjs` 的 `productPlugins` 和 `cordis.patch.yml` 对齐。`local-data` 在 `identity` 之前加载，之后装配账号界面、能力插件、会话选择和本地项目。知识库、产品智能体和远端项目协作插件不装配；保留 DSH 原生 Agent 供普通对话和专家使用。删除插件时还需从已装配目录清理旧包，防止旧构建残留进入安装包。

`local-data` 在基础 Home 管理唯一的 `seal-harness.sqlite`。`users`、`projects`、`experts`、`skills` 及状态、迁移记录表共用该库；数据库版本用 `PRAGMA user_version` 顺序迁移，启用外键与 WAL。Host 插件通过 `sealHarnessDatabase` 共享连接和事务。数据库是用户、项目、专家版本和技能包的持久来源；物化到文件系统的技能/专家目录是可重建缓存。自动迁移旧本地文件只复制、不删除原文件。远端项目数据不能靠本机自动迁移。

`identity` 只提供本地用户名密码认证与首次管理员创建，密码以独立 salt 和 scrypt 哈希存储。会话仅驻留 Host 内存。企业微信、SSO、远端密码和记住登录不属于当前产品。项目按用户保存绝对工作目录，用 DSH 公开 `sessions` 和 `uiWorkspace` 创建原生对话；删除项目记录不删除目录。专家、技能状态与包按用户存入 SQLite；知识库绑定和云端目录不属于默认 UI。DSH 原生会话历史由上游会话存储管理，不混入项目表。

## 验证

每次修改产品装配后运行 `corepack yarn seal-harness:build`、`corepack yarn seal-harness:check`，并检查 `scripts/verify-profile.mjs` 的实际插件组合。数据库迁移测试须覆盖原文件保留、重启后从 SQLite 恢复、不同用户隔离。认证测试须覆盖首次创建、错误密码、会话退出与重启、改密。项目测试须覆盖路径校验和按用户 CRUD。产品包核对 `lib` 与装配目录没有已删除的知识库、产品智能体及远端项目模块。构建/类型检查不等于真实 UI、模型回复、签名安装或跨平台通过；各自记录实测范围。

只提交本任务路径。遵守根 `AGENTS.md` 的版本规则：普通迭代仅递增补丁号；中间/主版本变更先取得用户明确同意。提交、推送和发布分别按授权执行。
