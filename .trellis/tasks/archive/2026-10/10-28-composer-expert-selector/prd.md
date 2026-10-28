# 会话专家选择器支持系统与个人并直接使用

## Goal

替换智能助手名称，按来源选择专家并绑定当前会话，不跳转资源页

## Requirements

- 会话输入栏“智能助手”改为“专家”；点击显示系统/个人专家下拉面板，可搜索、添加和移除，不导航到专家管理页。
- 选择仅作用当前会话，保留原会话历史、输入草稿和模型选择；已发言会话也可使用，忙碌时明确提示等待。
- 专家指令及绑定能力实际进入会话，按本地账号持久化并恢复，失败不能假装已选择。
- 当前没有系统专家种子，系统分组显示真实空态；个人使用已有当前账号专家，不虚构卡片。
- 用户已确认：每个会话最多一个当前专家，也可以不选；选择另一个直接替换，移除从后续消息生效，历史保留。保留其他窗口正在调整的技能/连接器分类和宽度改动，不修改上游，不提交推送。

## Acceptance Criteria

- [x] 专家排在技能、连接器之前；连接器分组复用技能标题间距并防止空分组外边距折叠。
- [x] 实际运行Host的experts/sessionList及sessionSet路由存在，真实窗口打开专家浮层无404；记录重启后的验收。

- [x] 单专家切换、清空、持久恢复、失败保留原专家及界面单选回归通过；再次构建并验证Profile。

- [x] 专家入口与分组、选择状态、错误和移除的构建后DOM回归通过，不跳转页面；搜索实现复用名称/描述/标签过滤。
- [x] 当前会话上下文/技能生效，跨会话/账号隔离，持久恢复与清理回归通过。
- [x] 连接器保留手动选择，专家引用独立记录，移除专家只释放专家引用。
- [x] 相关模块测试、产品构建、完整产品检查及真实Electron Profile验证通过。未发送真实模型请求，也未重启用户图形窗口。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
