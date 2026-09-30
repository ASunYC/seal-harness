# 本地登录与 SQLite 产品数据

## Goal

把 Seal Harness 的登录和核心内容改为独立、本机可运行的产品功能：单个本地 SQLite 数据库承载用户、项目、专家和技能；移除企业微信登录以及知识库、智能体产品插件，并重新设计带海豹品牌的登录界面。

## Requirements

- 登录由 Seal Harness 自有服务处理；默认按本机用户名与密码实现，首次创建管理员。移除企业微信登录入口、Host 处理器和相关配置。
- `~/.seal-harness` 下使用一个 SQLite 数据库，以明确的用户、项目、专家、技能等表存储本产品数据；数据库随显式 `DSH_HOME` 改变位置。
- 项目、专家、技能的实际 CRUD 与读取链路改用本地 SQLite，不仅新增一个与旧文件/远端链路并存的空数据库。
- 对来源工程旧数据仅做一次性复制导入，保留原文件；迁移失败时不切换正式读取路径，不删除旧用户数据。
- 从产品 bundle、构建、导航和检查中移除知识库、智能体产品插件及入口；保留 DSH 上游原生能力，避免改动只读子模块。
- 保留并显示现有 Seal Harness 小海豹 Logo，替换旧登录页及相关文案。
- 项目先完成本地创建、列表、编辑、删除、工作目录和原生对话；旧远端协作页签停用并给出明确状态，不继续请求来源服务。
- 保留第三方许可证、来源和固定版本号边界；不隐式推送或发布。

## Acceptance Criteria

- [x] 新账号可本地注册/登录/退出；错误登录不泄露账号信息，重启后重新登录，界面不含企业微信入口。
- [x] 用户、项目、专家、技能数据写入同一 SQLite 文件的独立表，读取、编辑、删除及用户隔离有真实测试。
- [x] 产品 Profile 不再加载知识库和智能体产品插件；相关导航入口消失，其他插件仍可正常激活。
- [x] 登录页显示 Seal Harness 名称和小海豹图标，应用图标及安装器资源保持一致。
- [x] 构建、受影响测试、Profile、类型、布局、LFS 和 Git 检查通过；未做的原生 GUI 与跨平台验收明确记录。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
