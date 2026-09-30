# Seal Harness 迁移验证

此文件只记录 2026-09-29 本次迁移对当前源码的检查。用户提供 ZIP 中的旧产品验收记录不视为 Seal Harness 的验证结果。

| 检查 | 结果 |
| --- | --- |
| ZIP 条目路径检查与源码展开 | 通过：2908 个文件，未发现路径越界或内嵌 `.git` |
| 新海豹图标格式与 provenance SHA256 | 通过：19 个资源哈希一致 |
| Yarn 4.18.0 / Node 24 | 通过；使用本机捆绑 Node 24 运行 Corepack |
| `yarn install --immutable` | 通过；原 ZIP 锁文件与依赖声明不一致，已由 Yarn 4 更新后重跑 |
| `seal-harness:build` | 通过；11 个产品业务插件和 Beta Desktop 已编译、装配 |
| `seal-harness:check` | 通过；产品配置、图标、Host/Client、项目、专家及 Profile 启动验证完成 |
| `check:layout` | 通过；双桌面变体、固定运行时、上游图标、双语文档和子模块布局一致 |
| `typecheck` | 通过；根工作区各 TypeScript 包检查完成 |
| `git lfs fsck` | 通过；19 个产品图标资源由 LFS 跟踪 |
| `git diff --cached --check` | 通过；旧 `_deprecated/` 补丁档案未迁入 |
| Windows/macOS/Linux 原生安装、图形启动、签名与升级 | 未执行；本机仅完成 headless 构建与测试 |

Windows 上有一个连接器测试夹具使用 POSIX shell 可执行文件，已按平台明确跳过；连接器其余测试通过。来源工程的 Geovis 和内网服务在 Seal Harness 中默认不连接，实际远端业务仍须在授权服务环境分别验证。未推送或发布。

## 2026-09-30 更新目录整合

从更新的来源目录整合资源页同步、连接器、会话技能选择、会话删除和默认工作区路径。`yarn install --immutable`、`seal-harness:build`、`seal-harness:check`、`check:layout` 与 `git lfs fsck` 已通过。产品检查包含 59 个根 Vitest 文件、1205 个用例，以及 project-agent 的 5 个用例；Profile 重复装配和启动检查也通过。一个连接器 POSIX shell 夹具仍按平台在 Windows 跳过。

根 `typecheck` 已通过，`git diff --check` 和 `git lfs fsck` 也通过；固定 `deepseek-harness` 子模块未改动。真实 Electron 窗口视觉检查、原生安装、签名和升级未执行，不能归入上述通过结果。源工程的个人截图路径与旧产品图标没有迁入，当前所有产品图标仍来自 Seal Harness 小海豹原图。
