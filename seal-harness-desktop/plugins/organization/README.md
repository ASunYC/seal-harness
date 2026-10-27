# Seal Harness 组织架构插件

`@seal-harness/organization` 将部门和人员目录规则放在 Seal Harness 的 Cordis Host，使用产品 SQLite 持久化。Client 通过 Connection RPC 展示和管理公司名称、部门树、人员与岗位。

每个本地账号拥有自己的目录。人员是目录资料，暂不能凭人员记录登录 Seal；本插件也不提供消息或群聊。部门移动时 Host 拒绝循环，删除前要求部门没有下级和人员。

界面和目录字段参考 Octop Enterprise（MIT）组织目录的使用方式；实现独立编写，不引入 Octop 的 Go 服务或 React 代码。
