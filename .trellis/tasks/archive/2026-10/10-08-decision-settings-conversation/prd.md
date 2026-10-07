# 问问决策设置与会话入口

## Goal

决策配置移入设置，一级决策入口打开原生可持续对话并调用结构化决策工具

## Requirements

- 将 TypeSafe Jev / 阿里百炼决策模型的选择、地域、WorkspaceId 与 API Key 配置移入原生“设置”弹窗，新增“问问决策”设置菜单；密钥继续只保存在 Host credentials 中。
- Seal Harness 一级“问问决策”入口打开 DSH 原生可持续对话会话，不再展示大表单。普通对话模型负责自然语言交互，在需要结构化判断时调用现有决策接口并标明来源；保留插件在普通 DSH 中的独立可用性。
- 点击一级决策入口可重新打开本次运行的决策会话；点击首页或其他原生会话能退出决策导航状态。无模型或无决策 API Key 时提供明确下一步，不虚构判断。
- 不修改只读 `deepseek-harness/` 子模块；不更改外部 API endpoint 与凭据格式。

## Acceptance Criteria

- [x] 设置弹窗出现“问问决策”菜单，可保存配置并安全回显已配置状态；一级入口不再显示配置和判断表单。
- [x] 一级入口打开原生会话，用户可连续发送消息；决策工具只在配置有效时返回真实结构化结果，模型可基于结果形成回复。
- [x] standalone DSH 插件的原有面板与 API 保持可用；产品构建、检查和 Windows UI 核对通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- 验证范围：Windows 隔离数据目录的原生设置和空白决策会话已做 UI 核对；由于未配置真实决策 API Key，远端模型调用和自然语言回复未做线上实测，Host 工具链路使用模拟 HTTP 响应验证。
