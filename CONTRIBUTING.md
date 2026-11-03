# 参与贡献

[English](CONTRIBUTING.en.md) | 中文

感谢你愿意参与 Seal Harness。无论你是普通用户、插件作者还是开发者，都可以在[本仓库](https://github.com/ASunYC/seal-harness)参与反馈、讨论和贡献。

## 普通用户：使用、反馈与传播

- 遇到问题或异常，请在 [Seal Harness Issues](https://github.com/ASunYC/seal-harness/issues/new/choose) 提交反馈，说明操作系统、Seal Harness 与内核版本、复现步骤和错误信息。
- 功能建议、使用求助和生态项目推荐统一在[本仓库 Issues](https://github.com/ASunYC/seal-harness/issues)交流；提交前先搜索已有问题。
- 发布版本及安装包见 [Seal Harness Releases](https://github.com/ASunYC/seal-harness/releases)，以实际发布的资产和说明为准。
- 欢迎提交使用教程、体验文章，以及文档和翻译改进。项目说明见 [README](README.md)。
- 附加日志或截图前，请移除 API Key、令牌、账号信息和其他敏感数据。

## 插件作者：扩展生态

Seal Harness 沿用 DSH 的插件、bundle 与 Profile 机制。编写插件前，可以参考：

- [Seal Harness 产品与构建说明](seal-harness-desktop/README.md)：产品身份、插件组合及验证边界。
- [插件开发](docs/plugin-development.md)：继承的 DSH Host、Web Client 与 Desktop 扩展合同。
- [DSH 插件生态倡议书](docs/plugin-ecosystem.md)：组合优先、声明清晰、兼容优先。
- [Community Market](dsh-community-market/README.zh.md)：市场的目录来源、安装确认与安全边界。

插件应尽量依赖公开合同，遵守用户授权和账号隔离，并保留第三方来源、许可证及通知。针对 Seal Harness 的改进请提交到本仓库；只涉及上游项目的问题，请在确认可以独立复现后提交到相应上游。

## 开发者：贡献代码

### 开发环境

要求 Node.js `^22.19.0` 或 `>=24.0.0`，以及根 Yarn `4.18.0`。先阅读根目录 [AGENTS.md](AGENTS.md) 和 [Trellis 工作流](.trellis/workflow.md)，再执行：

```sh
git clone --recurse-submodules https://github.com/ASunYC/seal-harness.git
cd seal-harness
corepack yarn install --immutable
corepack yarn seal-harness:build
corepack yarn seal-harness:check
corepack yarn seal-harness:dev
```

`seal-harness:dev` 会打开图形应用；构建、类型检查和其他自动化验证应保持 headless-safe。

### 仓库边界

- `seal-harness-desktop/` 维护产品身份、业务插件、组合与打包入口。产品自有包不加入根 Yarn workspaces，不另建锁文件。
- `deepseek-harness/` 是固定提交的只读上游子模块；不要在桌面功能修改中编辑其源码，更新 pin 应独立提交。
- `dsh-plugin-desktop-beta/`、`dsh-plugin-desktop/` 和 `dsh-desktop-next/` 是继承的桌面包。共享 Desktop 行为按 Beta 先行，并同步 Stable；Seal 专属功能优先放在产品插件中。
- 优先使用公开服务、事件、slot 和 bundle。详细边界及验证要求见[桌面构建契约](.trellis/spec/general/desktop-build.md)。

### 提交与 PR

- 向 [Seal Harness](https://github.com/ASunYC/seal-harness/compare) 提交 PR，描述问题、改动原因、验证结果和已知限制。
- 提交信息使用 Conventional Commits，说明使用中文，例如 `fix: 修复模型列表重叠`。
- 运行受影响功能的检查及产品检查；合并前运行 `corepack yarn check`。如有平台或环境限制，如实记录，不能把未执行或失败的检查写成通过。
- 共享 Desktop 修改需运行 `corepack yarn check:desktop-variants` 并验证两个变体；依赖变更同时核对锁文件和第三方许可通知。
- 文档修改同步中英文，并更新对应的 `*.i18n.yaml` 双语哈希记录。
- 不提交凭据、账号数据库、个人 Profile、临时文件或构建产物。

## 联系与行为准则

参与维护、协作和一般问题可在[本仓库 Issues](https://github.com/ASunYC/seal-harness/issues)联系维护者。上游项目的邮箱和交流群不作为 Seal Harness 的维护渠道。

请保持友善与尊重，就事论事。[参与者公约](CODE_OF_CONDUCT.md)适用于本项目空间；涉及私密信息的报告请先请求私密联系渠道，不在公开 Issue 中披露事件细节。
