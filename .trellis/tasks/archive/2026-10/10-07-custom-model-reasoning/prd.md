# 自定义模型推理档位设置

## Goal

在产品模型设置中按模型配置推理档位与请求映射

## Requirements

- Seal Harness 模型设置为手动添加的 pi-ai 模型提供逐模型的推理档位配置入口。用户选择支持的档位并填写发送给提供商的真实请求值；不凭供应商名称自动猜测。
- 保存后走 DSH 公开 settings namespace 的版本化写入，保留模型列表中其他字段和其他模型；冲突时拒绝覆盖并提示刷新。
- 未声明推理能力的模型继续不显示对话里的推理档位；声明的档位经现有模型适配器进入对话选择器和请求配置。
- 不修改只读 `deepseek-harness` 子模块，不引入第二套持久化；不修改用户现有的模型或凭据。

## Acceptance Criteria

- [x] 设置页可对自定义模型选择支持的档位、填写 wire 值、清除声明，并展示校验/冲突结果。
- [x] 其他模型配置不丢失；声明后对话菜单可显示对应档位，选择结果被模型调用层接受。
- [x] 产品构建、检查与 Windows 实际界面核对通过；用户当前 Profile 保持可用。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## 验证记录

- `corepack yarn seal-harness:build`、`corepack yarn seal-harness:check`、`corepack yarn check:layout`：通过。
- 单测验证目标模型的映射更新保留其他字段、校验非法档位、冲突提示，以及设置推送事件后新供应商模型出现在列表。
- Windows Electron 隔离账号验证：模型设置页显示卡片、`deepseek-v4.1-flash` 的四档真实值、保存成功提示。此前该模型的四档声明与 High 调用配置亦已通过运行时验证。
- 现有正常应用已重启；真实远端模型请求未执行，档位 wire 值须依据各服务商文档填写。
