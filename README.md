# Seal Harness

Seal Harness 是基于 [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) 机制构建的桌面智能体工作台。它通过 Cordis 插件、bundle 和 profile 组合产品能力；桌面窗口、托盘、Host 与插件装配沿用上游结构，产品身份与功能集中在 [`seal-harness-desktop/`](seal-harness-desktop/)。

本仓库迁入了用户提供的下游工程源码，保留 DSH Desktop、DeepSeek Harness 和其他第三方组件的许可证与来源说明。Seal Harness 是独立产品，不使用 DSH Desktop 的发布或更新渠道。

## 工程结构

| 路径 | 职责 |
| --- | --- |
| `seal-harness-desktop/` | 产品身份、海豹图标、插件组合、构建和打包入口 |
| `dsh-plugin-desktop-beta/` | 产品当前复用的桌面 Host、Client 与 Electron 壳 |
| `dsh-plugin-desktop/` | 上游 Stable 桌面变体 |
| `dsh-desktop-next/` | 上游 Next 实验桌面变体 |
| `deepseek-harness/` | 固定提交的上游子模块，只读 |
| `vendor/dsh-runtime/` | 固定版本的上游运行时包 |

产品插件由 `seal-harness-desktop/scripts/build.mjs` 编译，再通过 `cordis.patch.yml` 与 Profile 装配进 Beta Desktop；原生应用身份由 `product.json` 提供。默认数据目录为 `~/.seal-harness`，显式 `DSH_HOME` 可覆盖。首次启动创建本地管理员账号，用户、专家和技能存于同一个 `seal-harness.sqlite` 数据库。项目、知识库和产品智能体插件已移除，普通对话与工作区继续使用 DSH 原生能力。社区 Desktop 更新保持关闭。

桌面导航使用常驻一级窄栏：首页、空间和定时任务。原生新会话入口继续打开对话；首页的二级菜单组合专家、技能、连接器和插件。空间复用 DSH 工作区，定时任务目前提供明确空态。

## 开发

要求 Node.js `^22.19.0` 或 `>=24.0.0`、Corepack 与 Yarn `4.18.0`。从仓库根目录运行：

```bash
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn seal-harness:build
corepack yarn seal-harness:check
corepack yarn seal-harness:dev
```

Windows、macOS 与 Linux 打包入口分别为 `seal-harness:dist:win`、`seal-harness:dist:mac`、`seal-harness:dist:linux`，需在对应平台验证。图标原图为 [`seal-harness-desktop/assets/app-icon.png`](seal-harness-desktop/assets/app-icon.png)，其他尺寸与格式由 `scripts/export-product-icons.py` 导出。产品配置与验证边界见 [`seal-harness-desktop/README.md`](seal-harness-desktop/README.md)。

## 许可证与来源

本仓库保留 [`LICENSE`](LICENSE)、[`seal-harness-desktop/THIRD_PARTY_NOTICES.md`](seal-harness-desktop/THIRD_PARTY_NOTICES.md) 以及组件内的来源说明。DSH Desktop 和 DeepSeek Harness 的名称仅用于标明上游来源。
