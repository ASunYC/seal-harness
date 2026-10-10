# 边界与数据流

新增 seal-harness-desktop/plugins/scheduled-tasks 产品插件：Host 负责 SQLite CRUD、时间计算、调度和 Session Controller 执行；Client 负责现有一级入口的表单、列表、执行记录和打开原生会话。导航服务继续拥有一级 rail 和 main slot，新插件只注册该入口的内容。

local-data schema v3 增加 scheduled_tasks / scheduled_runs。运行记录预先保存唯一 session_id，调用公开 sessionController.create/rename/prompt/cancel，监听 session/event 的 turn/end。不启动第二个 CLI 或运行时，不修改上游子模块。每个任务只允许一个 running 记录；调度推进与记录创建同事务提交。重启将未结算记录标记 interrupted。

SQLite 只保存任务配置、运行状态和会话引用，完整模型输出继续由 DSH 会话持久化。执行按登录账号筛选，登录切换重新计算下次时间。界面查询最近 100 条记录，历史数据不自动删除；删除计划不删除原生会话。

改动路径：新产品插件；local-data 的迁移；navigation 的内容注册；build/profile/check 装配；相关回归测试与产品文档。现有入口、原生工作区与模型权限由原有服务管理。
