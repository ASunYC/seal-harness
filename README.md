# PiHarness

PiHarness 是一个面向 Node.js/TypeScript 的轻量 Agent Harness。它以
“能力皆插件”为设计原则，并将 Pi Agent 作为默认、可替换的运行时插件。

项目目前处于早期开发阶段。架构约束和实现计划见
[`docs/architecture.md`](docs/architecture.md)。

## 设计目标

- 微内核不依赖任何模型 SDK 或 Agent 实现。
- Runtime、Provider、Session、Tool、Policy、Context 和入口都是插件。
- 插件依赖显式、启动顺序确定、卸载完整、失败可回滚。
- 默认 Headless Profile 保持精简；TUI、Web、MCP、Skills 和 Subagent 按需安装。
- 上游 Pi 版本通过单一适配层隔离并由契约测试保护。

## 环境

- Node.js 22.19 或更高版本
- pnpm 11

## 当前状态

第一阶段正在实现零运行时依赖的插件微内核。此 README 会随着可运行 Profile
落地而补充安装和使用说明。

## License

MIT
