# Seal 默认工作区路径改为 seal-harness

## 目标

Seal 首次初始化工作区时使用 `<Documents>/seal-harness/default-workspace`，不再出现上游产品目录名。

## 要求

- 仅 Seal 当前使用的 DSH 0.2.1-rc.5 运行时采用产品目录名；不编辑只读上游子模块，也不改变其他 DSH 应用的默认值。
- Windows、macOS、Linux 的 Documents 解析和 `default-workspace` 末段保持原有逻辑。
- 已登记的旧目录与会话不自动移动、删除或重新指向；检查当前用户状态后再决定安全的切换方式。
- 保留工作区其他任务的未提交修改。

## 验收

- [x] 新安装环境的默认目录是 `<Documents>/seal-harness/default-workspace`。
- [ ] 当前用户的旧工作区和会话仍可访问；需要新路径时能安全切换。
- [x] 产品检查和构建通过，Seal 使用的 Beta Desktop 解析到修正运行时；其他 Desktop 版本保持原有锁定版本。
