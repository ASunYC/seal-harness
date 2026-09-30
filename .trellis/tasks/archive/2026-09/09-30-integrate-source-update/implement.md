# 执行计划

1. 盘点新来源与当前产品差异，按功能与品牌差异分组，保留报告在任务研究目录。
2. 迁入产品插件新增文件，逐模块整合资源页、连接器和会话选择器修改。
3. 审查新增上游 Yarn patch 的必要性及其对 Seal Harness 的命名和打包影响。
4. 检查新代码里的旧品牌字符串、窗口图标与默认服务地址，修正回 Seal Harness。
5. 执行受影响测试、产品构建/检查、根布局与资源检查，处理失败并记录未验证项。

## 完成情况

- 用户更新目录与同名 ZIP 一致；完成规范化差异盘点，来源新增功能和改动见 `research/source-diff.md`。
- 已整合资源页、连接器、会话技能选择与永久删除、商店缓存、Windows 开发快捷方式处理及相关测试；Beta 工作区补丁以 `seal-harness` 为默认目录。
- `product.json`、小海豹图标和图标 provenance、空的远端服务默认值、离线本地工作台及原有跨平台修复保持现状。
- `yarn install --immutable`、`seal-harness:build`、`seal-harness:check`、`check:layout`、根 `typecheck`、`git lfs fsck`、`git diff --check` 通过；子模块固定且干净。
- 实际 Electron 窗口视觉、原生安装、签名和升级尚未执行，详见 `docs/seal-harness/validation.md`。
