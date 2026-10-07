# 设置与账号移至一级导航底部

## Goal

移动原有设置和账号入口至一级窄栏底部，保留弹窗和用户页行为

## Requirements

- 设置和当前用户入口位于一级窄栏底部，二级宽侧栏不重复显示。
- 设置入口仍打开原有完整设置弹窗；账号入口仍按登录状态打开本地用户页或登录页。
- 首页资源、工作区、会话及问问决策等一级入口保持现有功能。
- 折叠侧栏和窄窗口下，底部入口仍可见、可点击且不与一级菜单重叠。

## Acceptance Criteria

- [x] 设置与账号图标在一级栏底部，宽侧栏不再显示对应文字行。
- [x] 实际点击设置可打开完整弹窗，关闭后仍可继续使用；账号打开原有用户页。
- [x] 构建、产品检查和 Windows 窗口布局验证通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
