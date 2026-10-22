# DSH 0.2.1-rc.2 升级记录

日期：2026-10-22。目标为 [官方 dsh-v0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)，不是自动跟随 main。

## 版本与来源

| 项目 | 结果 |
| --- | --- |
| Seal Harness 使用的 Beta 内核 | `0.2.1-alpha.2` → `0.2.1-rc.2` |
| 固定源码提交 | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| 官方运行时 | npm 原始发布包 343 个，逐包校验 SRI，并记录 SHA256 |
| Beta 框架 | Cordis `4.0.5`、schemastery `3.18.5` |
| Stable / Next 内核 | 分别保留 `0.2.0-rc.2` / `0.1.7-alpha.2` |
| AA 源码 | 保留 `7fe1fce32650483bf8433f7a198032178580ff16`，不附带更新 AA 功能 |
| AA 产物 | `2.0.3-desktop.c7fe1fce32650.rb87df718`，两通道使用同一包 |

源码子模块只更新固定提交，没有修改内部源文件。运行时来源、版本、原始字节哈希见 `upstream.json` 与 `vendor/dsh-runtime/0.2.1-rc.2/manifest.json`。Seal Harness 产品版本及更新渠道独立于内核版本；本轮不发布安装包。

## 兼容处理

- 移植 22 份已有 Desktop 补丁；对 Profile 组合、插件管理页和桌面引导页按新结构适配，保留新增上游页签。
- 新增一份工作区声明补丁：让 `slots.d.ts` 引入实际拥有 `workspace.toast` 的契约，保持严格类型检查。
- HMR 在公开 Loader 模式下先判断内部 ESM 缓存是否可用，再执行缓存访问；配置监听继续保留，模块级 HMR 仍要求内部接口。实际两轮配置热重载验证通过。
- `webServer.port` 在未监听时允许缺省。市场按每次请求的实际端口校验；Desktop 在生成地址和附加 LAN 边缘前验证绑定状态，不使用默认端口掩盖未就绪状态。
- 会话持久化模块改用模块式入口。共享兼容适配保留 Stable 的默认类入口与 Beta 的新入口；两通道都实测 V2 → V4 迁移并保留原始日志。
- AA 临时构建统一源码声明的开发类型图，运行时 peer 则接受两通道版本，避免两份 schemastery 的声明冲突。来源标记校验同时接受正式源版本与预发布源版本，提交号和 SHA 校验保留。

## 验证范围

当前已通过官方运行时及补丁校验、双变体源码对齐、不可变安装、AA 构建/类型/产物检查、全仓类型检查、布局检查和完整产品构建。Market 端口与路由的 21 项回归通过；两通道的迁移与网络边界测试各 4 项通过；Profile 激活与两轮 HMR 单独验证通过。

最终通过：

- 根不可变安装、`seal-harness:build`、全仓 `typecheck`、`check:layout`、`seal-harness:check`。
- 产品检查 186 项通过、3 项按平台/实测开关跳过；真实 Profile 激活及两轮 HMR 通过。
- Beta 8 个定向测试文件、Stable 7 个定向测试文件，各 129 项通过；Market 路由 21 项和启动器 UI 1 项通过。
- 最终 343 个 Beta 原始包哈希、202 个共享源码文件对齐及 `git diff --check` 通过，源码子模块无内部修改。

本机曾遇到 Electron 冷启动和 Vitest 子进程启动超时，单独复核后按原门禁重跑通过，未放宽超时或跳过断言。没有执行真实供应商模型或 Search/Fetch 请求，也没有执行图形应用、签名安装、覆盖升级及 macOS/Linux 图形验证。
