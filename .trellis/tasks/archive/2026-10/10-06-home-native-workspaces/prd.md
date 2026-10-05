# 恢复首页原生工作区与会话列表

## Goal

首页并列资源入口与原生工作区会话，空间不重复承载工作区

## Requirements

- 首页侧栏保留 DSH 原生工作区树、会话列表及其搜索、新建、打开、重命名等已有交互。
- 专家、技能、连接器、插件和其他已注册资源与原生工作区树同处首页侧栏，不能通过覆盖工作区 slot 取代它。
- 首页无需重复的“会话”菜单或“SEAL HARNESS / 首页”标题。
- 一级“空间”保留入口，但不展示、添加或迁移工作区；当前显示明确的未开放空态。
- 定时任务继续保持现有空态，数据和登录服务不变。

## Acceptance Criteria

- [x] 首页同屏显示资源入口、原生工作区和已有会话，原生操作可用。
- [x] 切换专家、技能、插件及返回聊天时，工作区和会话列表仍在首页。
- [x] 空间不再列出或添加已有工作区。
- [x] 产品构建、导航测试和 Windows 实际窗口验证通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
