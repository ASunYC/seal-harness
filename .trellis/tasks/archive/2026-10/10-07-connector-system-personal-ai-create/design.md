# 设计与边界

连接器现有 Host 持久化在 DSH credentials grant record，包含凭据，继续沿用该安全存储；不把明文凭据迁移到 SQLite。对配置增加可选 `installed` 字段，旧记录缺失时视为已安装。模型工具 `create_connector` 只接受无凭据的连接定义，走 Host 的 `createDraft` 校验与持久化，保存为未安装、未启用。`installPersonal` 重新校验传输配置并标记已安装，保持未启用，用户再通过现有管理面板配置认证并启用。运行时、会话选择和专家能力目录过滤未安装项。前端沿用既有连接器卡片和详情弹窗；本地包导入仍由原编辑器执行。公开商店安装 Host API 保留，页面内目录入口移除。

变更仅在 Seal Harness 产品插件与构建契约，不动上游 DSH、数据库 schema 或远端服务。现有已安装连接器通过回归测试保持管理行为。
