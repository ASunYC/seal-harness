# ADR-0001：以独立微内核承载 Pi runtime 插件

- 状态：Accepted
- 日期：2026-08-25

## 背景

Pi 提供成熟的 TypeScript Agent loop、模型抽象、工具调用和流式事件。Pi Coding
Agent 还提供完整的 CLI、TUI、Session、资源加载和扩展系统，但直接以它为宿主会
让 Agent loop、Session 和产品生命周期成为特权核心，无法达到“能力皆插件”。

DeepSeek Harness 使用 Cordis 将所有能力组合为插件。其生命周期和可逆副作用思想
值得采用，但完整产品组合并不轻量，引入 Cordis 也会把公共插件 API 绑定到另一套
框架语义。

## 决策

实现一个零运行时依赖的独立微内核，并把 `@earendil-works/pi-agent-core` 包装为
默认 `runtime-pi` 插件。

第一版使用 Pi 的 `Agent` 类，而不是完整 `pi-coding-agent`。不直接使用 Pi 的高级
`AgentHarness` 作为产品内核，以免固定 Session、Compaction 和恢复语义。未来需要
更强控制时，可以只替换 runtime 插件为基于低层 `agentLoop()` 的实现。

## 后果

正面影响：

- 默认体验复用 Pi，宿主和插件契约保持独立；
- Pi 升级影响集中在少数适配包；
- 测试可以替换 runtime、provider、session 和 policy；
- 默认 Profile 可以只装真正需要的能力。

代价：

- 需要自行维护插件生命周期、服务拓扑和契约测试；
- Pi Agent Core 仍会传递依赖 `pi-ai`，安装闭包不会极端小；
- 热更新、动态 Profile patch 和插件市场延后实现。
