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
