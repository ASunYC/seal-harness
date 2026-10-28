# 标题栏显示实际DSH内核版本

## Goal

标题栏自动跟随集成内核版本，保留Seal发布版本与安装身份

## Requirements

- 标题栏显示实际安装的 @deepseek-ai/dsh 内核版本，构建时自动读取。
- 沿现有产品配置 define 增加可选 displayVersion；原生兼容标题栏无产品插件 slot，需最小共享接缝，Beta 先改并同步 Stable。
- 保持 Seal 产品清单、安装包版本与更新渠道不变；不修改只读子模块，保留现有其他工作，不提交或推送本轮改动。

## Acceptance Criteria

- [x] 标题栏按钮、无障碍文本、悬浮面板共用同一个 DSH 内核版本参数；DOM 渲染及产物检查通过，未重启真实窗口。
- [x] 未指定 displayVersion 的上游仍显示 environment.version。
- [x] 配置验证、标题栏渲染、两变体类型检查、镜像与实际产品构建验证通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
