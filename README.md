# PiHarness

PiHarness 是一个面向 Node.js/TypeScript 的轻量 Agent Harness。它以
“能力皆插件”为设计原则，并将 Pi Agent 作为默认、可替换的运行时插件。

当前已经具备可运行的 Headless Agent 主链路：

- 零运行时依赖的插件微内核；
- 原生 ESM Profile；
- `@earendil-works/pi-agent-core` Runtime；
- 可选择加载的 Pi AI Provider；
- JSONL/Memory Session；
- 强制 Policy/Approval 的工具执行管线；
- 防路径和符号链接逃逸的工作区工具；
- 分层 `AGENTS.md` 上下文；
- Headless CLI。

项目仍处于早期开发阶段，Session 崩溃恢复、Compaction、Skills、MCP 和发布流程
正在按 [`docs/development-plan.md`](docs/development-plan.md) 实施。

## 环境

- Node.js 22.19 或更高版本
- pnpm 11

Pi 当前也要求 Node.js 22.19 以上。低版本 Node 可能在启动测试工具之前就失败。

## 从源码运行

```sh
corepack enable
pnpm install
pnpm check
pnpm build
```

配置 Provider API key，例如：

```sh
export DEEPSEEK_API_KEY=...
```

运行：

```sh
pnpm piharness -- --provider deepseek --model deepseek-chat "检查这个仓库"
```

如果省略 `--model`，CLI 使用该 Provider 目录中的第一个模型。Session 默认保存在
当前工作区的 `.piharness/sessions`。

常用安全选项：

```sh
# 完全不注册 shell 工具
pnpm piharness -- --no-shell "只分析代码"

# 非交互环境明确拒绝所有 ask 决策
pnpm piharness -- --deny-approvals "检查并修复问题"
```

`--yes` 会允许所有 `ask` 决策，只应在隔离环境中明确使用。

## 离线示例

无需 API key 的 Scripted Model Profile：

```sh
pnpm build
node apps/cli/dist/bin.js \
  --config examples/scripted-agent/piharness.config.mjs \
  --provider scripted \
  --model demo \
  "hello"
```

## 包结构

| 路径 | 职责 |
|---|---|
| `packages/kernel` | 服务拓扑、事件、Effect、回滚和卸载 |
| `packages/core` | Provider-neutral Agent 能力契约 |
| `packages/host` | Profile 发现、校验和启动 |
| `plugins/runtime-pi` | Pi Agent Runtime 适配 |
| `plugins/provider-pi-ai` | Pi AI ModelService |
| `plugins/agent-core` | Context/Session/Runtime 编排 |
| `plugins/tools-core` | 强制 Policy 的工具执行管线 |
| `plugins/workspace-tools` | 文件、搜索和 Shell 工具 |
| `plugins/session-*` | 可替换 Session Store |
| `apps/cli` | Headless 入口与默认 Profile |

## 插件

插件开发从 [`docs/plugin-development.md`](docs/plugin-development.md) 开始。安全模型见
[`docs/security.md`](docs/security.md)，总体架构见
[`docs/architecture.md`](docs/architecture.md)。

## 验证

```sh
pnpm clean
pnpm check
pnpm build
```

测试包含真实 Pi Agent loop 的文本流、工具调用和临时仓库 Headless E2E；模型响应
使用确定性 Scripted Model，因此不消耗 API key。

## License

MIT
