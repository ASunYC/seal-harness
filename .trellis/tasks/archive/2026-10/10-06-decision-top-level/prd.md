# 问问决策提升为一级导航

## Goal

从首页资源列表移出问问决策，置于首页之后的一级导航并打开独立页面

## Requirements

- 一级窄栏顺序改为首页、问问决策、空间、定时任务。
- 问问决策从首页侧栏的功能列表移除；点击一级入口打开插件现有的独立决策页面。
- 决策页选中时一级入口高亮，返回首页仍保留工作区、会话和其他资源入口。
- DSH 独立安装版的问问决策插件仍使用原有侧栏入口；本次仅改变 Seal Harness 组合方式。

## Acceptance Criteria

- [x] 首页不再出现问问决策行，一级导航在首页后显示问问决策。
- [x] 点击一级入口能打开决策页面并保持选中，返回首页后原生工作区与会话仍在。
- [x] 构建、导航测试与 Windows 窗口验证通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
