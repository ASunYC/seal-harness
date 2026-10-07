# 连接器页已安装与系统个人模型创建

## Goal

按技能页结构重组连接器，保留安装与凭据管理，模型创建未安装个人连接器

## Requirements

- 连接器页沿用技能页结构：独立“已安装”区块，下方“系统 / 个人”页签。系统当前无内置连接器时显示空态；个人显示本机创建及导入的连接器。
- 去掉页面上的同步状态、已安装弹窗、精选场景、公开/被授权目录。插件市场仍由现有独立入口负责，不改变安装商店连接器的 Host 接口。
- “创建连接器”打开原生会话并预填可编辑模板。模型通过产品工具保存未安装的个人连接器配置；用户显式安装后，才进入已安装区块并可配置凭据、启用工具。
- 保留现有已安装连接器、凭据管理、OAuth、工作区绑定、工具管理和本地连接器包导入。旧数据按已安装解释。

## Acceptance Criteria

- [x] 页面结构、创建入口和导入入口符合需求；无同步状态或已安装弹窗。
- [x] 未安装连接器不进入运行时、会话选择器、专家可绑定列表；安装后可使用原管理流程。旧连接器保持可见和可用。
- [x] 连接器 Host、模型工具、页面测试与产品构建检查通过；Windows 实际页面核对。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## 验证记录

- `corepack yarn seal-harness:check`、`corepack yarn seal-harness:build`、`corepack yarn check:layout`：通过；构建后 Profile 启动组合验证通过。
- 连接器 Host、模型工具和页面共 29 项测试：28 通过，1 项 Windows 不适用的 POSIX 可执行属性测试跳过。
- Windows Electron 隔离账号实际页面核对：已安装区块、系统/个人页签、导入 ZIP 弹窗可见；点击创建连接器进入原生会话并填入未发送模板。
- 未配置模型凭据，真实模型生成回复尚未实测；模型工具保存、显式安装和运行时隔离由自动化测试验证。
