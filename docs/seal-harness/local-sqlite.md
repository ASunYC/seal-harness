# 本地登录与数据

2026-09-30 的产品改造以用户明确要求为准：Seal Harness 自带本地登录，项目、专家和技能接入同一个 SQLite 数据库；企业微信登录、知识库和产品智能体插件从产品装配中移除。普通对话仍使用 DSH Desktop 的原生 Agent、会话和工作区服务。

## 登录与数据库

基础 Home 默认为 `~/.seal-harness`，显式 `DSH_HOME` 可覆盖。`local-data` 在该目录建立 `seal-harness.sqlite`，启用外键、WAL 和 `user_version` 迁移。核心表为 `users`、`projects`、`experts`、`skills`，另有 `expert_state`、`skill_state` 与 `import_journal`。所有产品模块共用这一连接和事务，包内容以 ZIP BLOB 保存。首次运行创建唯一管理员账号；登录采用用户名和密码，密码以 salt 与 scrypt 哈希保存。会话只在运行内有效。

## 本地业务

- 项目保存名称、绝对工作目录和所属用户。创建对话时调用 DSH 公开会话服务并以项目目录为工作目录。删除项目不会删除磁盘目录。
- 专家的状态和版本包写入 SQLite。基础 Home 中原有本机状态与包在首次登录时复制导入，旧文件保留；运行目录可由数据库重建。
- 技能的状态与 ZIP 包写入 SQLite。基础 Home 中原有本机包复制导入；供 DSH Skill Registry 读取的目录位于 `seal-harness-cache`，可由数据库恢复。
- 旧远端项目清单仅在原服务存在，无法凭本机源码自动导入。本地项目清单从空表开始，可重新关联已有工作目录。旧远端账号专属 Home 不会自动归属新本地账号。DSH 原生会话历史由上游保存，未迁入产品项目表。

专家/技能的云端能力代码仍留在源码中，但默认 UI 仅展示本地内容。本地账号令牌不会发送至远端能力仓库；需要远端能力时须另行设计独立的远端认证。连接器仍可连接明确配置的 MCP 服务。旧知识库和产品智能体安装包在产品装配时清理，不参与 Profile。

## 验证边界

产品 `seal-harness:build` 与 `seal-harness:check` 检查编译、Host/Client 插件、SQLite 行为和实际 Profile。Windows 本机结果不代表 macOS/Linux 原生安装、签名、升级或模型回复已验证。每次验收结果追加到 [验证记录](validation.md)。
