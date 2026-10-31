# 知识库改为左右分栏导航

## Goal

知识库采用与能力页一致的左右结构：左侧导航展示知识库列表，右侧展示知识库内容和操作。

## Requirements

- 左侧知识库栏与能力二级栏同宽、同视觉层级，列表在空库、加载、连接失败和已有库状态下都有合适反馈。
- 右侧保留创建、刷新、设置、文档管理、检索、编辑和删除操作。
- 窄窗口仍能访问列表与内容，不因嵌套滚动或外层边框遮挡操作。

## Acceptance Criteria

- [x] 空库时左侧显示真实空态，右侧引导创建知识库。
- [x] 创建和切换知识库后左侧选中态与右侧内容一致。
- [x] 现有知识库操作回归测试通过，桌面实测左右分栏正常。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
