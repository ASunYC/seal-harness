# 设计

默认rail自动化任务选中seal-harness-schedules，使用现有SchedulesPanel与scheduled-tasks公开注册。native schedules仍保留原main插槽，页面内只提供明确的会话提醒入口，rail在native页面仍高亮自动化任务。无上游补丁，不劫持DOM点击，不合并不同调度数据。

ScheduledTasksPanel左栏提供标题、新建、搜索/状态和任务列表；右栏显示空态、选中任务操作与记录或创建/编辑表单。form是现有状态，保存调用原save，返回真实id用于选择。登录epoch key继续隔离，工作区和时间规则由Host验证。旧数据和session runner不改变。

写入链：form->RPC save->ScheduledTasksService->scheduled_tasks；执行链：tick->claim->独立session runner->执行历史。保存和新建取消均不能调用session API。已有上下游测试补充导航入口与真实表单保存/取消/四频率/重载；调度用隔离数据库与受控时钟验证不触发用户任务。
