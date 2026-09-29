# DSH 0.1.7 升级

2026-09-23：Seal Harness改用 `dsh-plugin-desktop-beta`，运行内核为 `0.1.7-alpha.2`。Harness 源码固定在官方发布提交 `00102833df`，保持只读。使用现有上游 vendor、补丁和 Yarn 锁文件机制，未引入第二套依赖管理。

升级依据：Desktop 上游 `bcf5faba85`、`2a0a6d34c2`、`69982afb28`；保留本仓库的Seal Harness产品接缝。Stable 仍使用其原有 0.1.5 内核。

## 行为

- 产品名称、应用 ID、默认 Home 仍是Seal Harness、`com.seal-harness.desktop`、`~/.seal-harness`；显式 `DSH_HOME` 仍优先。社区产品更新保持禁用。
- 产品 bundle 显式启用 `ui-sidebar-browser`。入口在会话右侧栏 → 浏览器。
- 当前 Beta 外壳使用官方 iframe 载体，已打开 `https://example.com`。禁止 iframe 的网站仍应使用系统浏览器；没有接入 Next 的原生 webview bridge，也没有自动赋予 AI 浏览器操作工具。
- 专家模块改用 `agentPresets.register()` 注册，并使用 disposer 卸载；运行中的旧版本通过官方作用域租约保留。专家 ZIP 和状态存储不变。

## 实测

- macOS arm64 构建、实际启动、旧会话历史加载、真实模型回复、浏览器网页加载和正常退出已通过。
- Seal Harness产品与能力测试、真实 Profile 加载及两次 HMR、运行时完整性和变体检查通过。
- Beta 普通构建后的全量测试为 1,538 通过、8 跳过；Stable 受影响范围测试为 21 通过、4 跳过。Stable、Beta、Next 类型检查通过。
- 上游源码测试不能混用Seal Harness定制 Host 产物；混用时已观察到 HMR 退出等待。先用普通构建执行上游测试，再重新生成Seal Harness产物执行产品检查。
- Windows/Linux 安装打包与签名未执行。

## 恢复

运行前将现有 `~/.seal-harness` 完整备份至 `.trellis/.runtime/runtime-017-browser/home-backup`（本地忽略目录）。升级前源码基线为 `ce7b299c01`。恢复旧内核前先退出Seal Harness，使用备份数据；不要让旧内核直接写升级后的会话数据。
