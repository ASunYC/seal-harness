# 首页二级菜单改为会话与资源

## Goal

移除首页概览和卡片，首页二级菜单以会话、专家、技能、连接器、插件为唯一入口。

## Requirements

- 一级导航保留首页、空间、定时任务，不增加对话入口。
- 首页二级菜单依次显示会话、专家、技能、连接器、插件；不显示概览或资源分组。
- 会话进入原有桌面聊天界面，专家等继续使用现有资源页面，插件进入现有插件管理页。
- 空间沿用现有工作区能力，定时任务保留现有空态。

## Acceptance Criteria

- [x] 首页不再渲染概览页、介绍语或资源卡片。
- [x] 一级首页与二级会话都能回到原有聊天界面；资源和插件仍可切换。
- [x] 桌面构建与导航测试通过，运行中的应用更新到新界面。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
