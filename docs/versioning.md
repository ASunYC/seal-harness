# 版本与兼容策略

## PiHarness

所有公开包在 1.0 前保持统一版本。`0.x` 次版本可能包含公共插件契约破坏；变更必须
提供 Changelog 和迁移说明。1.0 后遵循 Semantic Versioning。

Profile 配置与 Session 物理格式分别版本化。当前 JSONL 事务声明
`formatVersion: 1`，SQLite 使用 `PRAGMA user_version = 1`；未知版本失败关闭，后续
格式变化必须提供显式迁移入口。

## Pi

`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 使用精确版本。升级步骤：

1. 更新两个直接依赖和 lockfile；
2. 运行消息签名 round-trip；
3. 运行文本、Abort、Steering、Follow-up、并行工具和错误契约测试；
4. 运行临时仓库 Headless E2E；
5. 运行 pack-install smoke。

Pi 类型不得越过 `runtime-pi` / `provider-pi-ai` 边界，因此普通插件不随 Pi 升级。

## Node.js

支持 Node.js 22.19 及后续活跃主版本。CI 当前验证 22.19 和 24。SQLite 插件依赖
该范围内的内置 `node:sqlite`。
