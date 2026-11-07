# 右侧侧边聊天

## Goal

在 Seal 右侧页签复用 DSH 会话能力，并支持选中文本发起侧聊

## Requirements

- 当前会话右侧可打开独立侧聊页签，使用 DSH 原生会话、记录和输入框。
- 侧聊仅存在于右侧页签，不加入工作区会话列表；关闭页签后停止侧聊并清理其记录。
- 已由旧版创建并显示在工作区的侧聊会话从列表中移除，保留其打开的右侧页签直至关闭。
- 主对话选中文本后可将引用送入侧聊草稿，用户自行补充问题并发送。
- 主对话标题栏提供侧聊入口；不修改上游 Desktop。

## Acceptance Criteria

- [ ] 侧聊页签能显示原生聊天并发送消息。
- [ ] 选中文本不会自动发送；重开同一侧聊能继续使用。
- [ ] 主会话切换后，侧聊各自独立；若 DSH 恢复右侧页签，插件能恢复其内容。
- [ ] 左侧工作区不出现侧聊；关闭右侧页签后，侧聊 Agent 和持久化记录均清理。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
