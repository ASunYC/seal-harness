# cc-haha 功能插件化改造

## Goal

在 Seal Harness 现有导航结构下，通过 profile 装配与产品插件，使产品具备 cc-haha 的桌面功能集。用户自有左侧菜单结构不参与本次改造。

## Requirements

- 运行时采用混合策略：Agent 核心、会话、工具、权限、模型复用 DSH 原生能力；cc-haha 独有能力（Workflow UI、Agent Teams UI、Computer Use、Browser Use、定时任务、桌面宠物、H5 远程、IM 接入）以产品插件形式实现。
- 插件形态统一为 `seal-harness-desktop/plugins/<name>/`，非 workspace，不创建第二份锁文件，复用 Beta Desktop 的 `node_modules`。
- 装配优先：官方已有 bundle 或可解析包，优先在 profile patch 层装配，不重写官方实现。
- 按界面区域划分插件边界，每个插件对应一个可独立验证的能力域，可单独禁用与卸载，卸载后不残留样式、slot、订阅或子进程。
- 不动只读的 `deepseek-harness/` 子模块；不修改共享 Desktop 行为时不触及 Beta/Stable 双变体镜像。
- 本任务排除技能与连接器（用户在其他机器上并行改造）。
- 版本号只递增补丁位；提交授权不含推送。

## Acceptance Criteria

- [ ] 能力矩阵落盘：每项能力标注真实状态（已装配 / 已安装未装配 / 可添加 / 不可用），并区分「已装配但配置未启用」。
- [ ] 阶段 1 装配完成后 `corepack yarn seal-harness:build`、`seal-harness:check`、`check:layout` 通过，Profile 无 `entries did not activate`。
- [ ] 每个新增装配项在隔离 `DSH_HOME` 的真实 Electron 窗口中实际可用，逐个记录。
- [ ] 阶段 2 起的每个新产品插件具备 host/client 测试，覆盖正常路径、空态、错误态、卸载清理。
- [ ] `docs/seal-harness/cc-haha-plugin-migration.md` 的能力矩阵按实测结果更新，取代初版估算。
- [ ] `docs/seal-harness/validation.md` 追加本轮实测范围，明确区分未执行的平台与项目。

## Notes

- 核心风险是「已装配 ≠ 可用」。`dsh-web-app` 已装配大量能力 UI，但部分存在配置级关闭（如 `session-query-sqlite` 的 `openAt: never`）；每项必须实测，不能凭包在 patch 里就判定可用。
- Windows 本机通过不代表 macOS/Linux 通过；构建与单测不等于视觉验收与原生安装。
