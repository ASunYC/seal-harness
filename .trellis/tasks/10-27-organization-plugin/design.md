# 设计

- `@seal-harness/organization` 是产品自有的 Host + Client 插件。Host 依赖 `sealHarnessDatabase`、`sealHarnessIdentity`、`connection`；Client 依赖 Connection、Identity Client、Navigation，并在首页资源列表注册“组织架构”。
- Host 服务拥有目录规则。`sealHarnessDatabase` 增加版本迁移，存储账号作用域内的公司名称、部门与人员。数据库外键限制跨账号引用，并用服务层检查循环和非空删除。RPC 只接受业务字段，账号从 Host 当前会话读取。
- 部门记录包括 `id/name/parent_id/sort_order/enabled`；人员记录包括 `id/name/department_id/job_title/email/phone/status`。这里的人员是可管理的组织目录记录，与本地登录 `users` 分离。后续若接企业身份，需要显式迁移与关联设计。
- 页面采用独立两栏：左侧组织树与搜索，右侧部门成员或人员详情；编辑用简短表单。消息和群聊不纳入这次界面。
- 参考 Octop 的目录语义与界面信息结构，不复制其 Go/React 实现。参考仓库为 Octop Enterprise，MIT 许可；本次改动均在 Seal 产品插件内。
- 修改 `build.mjs` 与 `cordis.patch.yml` 时仅增量接入组织插件，保留工作区已有 WeKnora 改动。
