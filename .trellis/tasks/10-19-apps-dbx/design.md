# 设计

新增产品插件 apps，使用公开导航注册和 RPC。local-data 数据库 v4 增加 application_installations，按账号保存安装阶段与官方包来源。运行时与 data 分离，data 永不由卸载删除。安装在受控的账号哈希目录先临时解压，文件校验后原子改名；中断状态可重试，后台串行操作避免安装卸载竞争。

connectors 增加仅 Host 可调用的 registerApplication/removeApplication 接口，通过 configSchema 校验，保存 ownerAccountId 和 managedApplication；现有 MCP Client 子插件负责进程、工具注册与会话隔离。安装后自动启用，不自动替用户向聊天发送消息；会话通过既有连接器选择器加入 DBX。默认遵循 DBX 新目录的只读策略，用户在 DBX 中配置连接与 MCP allowlist。

DBX 固定 v0.6.48，MCP 固定 packages-v0.4.124。以官方 release asset SHA-256 校验；不经 npm 或第二套运行时安装。GUI 和 MCP 均设置 DBX_DATA_DIR，避免配置错位。只打开固定受校验的本机 exe；程序仍运行时卸载明确要求退出后重试，失败不伪报卸载成功。

发布来源：https://github.com/t8y2/dbx/releases/tag/v0.6.48 和 https://github.com/t8y2/dbx/releases/tag/packages-v0.4.124 。桌面和 MCP 发布版本不同，必须分别 pin，不能用 latest 自动组合。DBX 数据目录实现已对照 v0.6.48 的 src-tauri/src/data_dir.rs：DBX_DATA_DIR 优先于 portable.dbx 标记，也不会自动导入系统其他安装的数据目录。

修改边界：apps 新插件；local-data 迁移；connectors Host 管理接缝和关联标识；navigation 图标；产品 build/patch/check 装配；任务及产品契约文档。上游 Desktop/只读子模块不改。
