# 整合更新的智作工程差异

## Goal

提取更新工程的功能差异并保持 Seal Harness 品牌与产品边界

## Requirements

- 比较用户更新的 `D:\git-workspace\AI\zhizuo-master\zhizuo-master` 与当前 Seal Harness 工程，识别新增实现、修改和旧品牌差异。
- 整合来源工程中新的资源页、连接器、会话选择器和相关修复，保持现有 DSH Desktop 插件/Profile 装配机制。
- 所有产品名、包名、资源、默认 Home、应用 ID、界面身份仍为 Seal Harness；保留小海豹图标及当前离线服务默认值。
- 保持上游子模块固定只读，不导入旧任务状态、生成产物或来源工程的个人验收路径。

## Acceptance Criteria

- [x] 有明确的来源差异清单，所选功能更新已整合且没有覆盖 Seal Harness 自有配置与资产。
- [x] 构建、产品检查、受影响模块检查和资源校验通过，未执行的平台验证如实记录。
- [x] 旧产品身份不会进入运行时界面、包名和安装器；Git diff 与子模块状态干净。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
