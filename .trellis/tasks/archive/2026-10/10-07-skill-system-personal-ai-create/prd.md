# 技能页系统个人与模型创建

## Goal

保留已安装与安装流程，移除同步和手工创建，增加系统个人与模型创建

## Requirements

- 技能页移除“已同步”状态、刷新按钮及“发现本地”页签；“导入 Skill 包”改为“导入技能”。
- 保留独立的“已安装”区块和安装、启用、停用、管理流程。下方使用“系统 / 个人”页签展示技能，不把“已安装”做成页签。
- “创建技能”进入原生会话并预填可编辑提示词；模型完成创建后将技能保存到当前用户的本地个人列表。创建动作不直接安装技能，用户可从个人列表安装。
- 移除手工新建技能页面，保留已有技能的详情与编辑能力。旧数据按已安装处理，不破坏现有技能。

## Acceptance Criteria

- [x] 页面按“已安装”独立区块及“系统 / 个人”页签呈现，无同步状态与手工创建页。
- [x] 本地模型创建工具通过既有技能存储保存个人技能；未安装技能不进入运行时目录；点击安装后进入已安装区块。
- [x] ZIP/目录导入和现有已安装技能仍可管理；相关测试、构建与桌面检查通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## 验证记录

- `corepack yarn seal-harness:check`：通过，含技能 Host、模型工具、会话模板与页面测试；Windows 不适用的可执行属性测试保持跳过。
- `corepack yarn seal-harness:build`：通过；修改专家能力筛选后再次构建通过。
- `corepack yarn check:layout` 与 `verify-profile.mjs`：通过。
- Windows Electron 隔离账号视觉核对通过；“创建技能”进入原生会话并填入未发送模板。正式应用已重启。
- 未配置模型凭据，因此未进行真实模型回复测试；工具保存与安装链路由自动化测试验证。
