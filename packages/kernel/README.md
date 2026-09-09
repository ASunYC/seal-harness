# @seal-harness/kernel

Seal Harness 的零运行时依赖插件微内核。

它提供类型化服务令牌、稳定依赖拓扑、顺序事件、插件作用域副作用以及失败回滚。运行中的
Kernel 可通过 `reconfigure()` 更新运行中的插件图；未变化的拓扑前缀保持存活，从首个变化
实例开始按依赖逆序释放并重启其下游。新后缀启动失败时会自动恢复上一组已知可用实例。
`pluginIds` 提供当前实际存活的实例顺序。
它不包含 Agent、LLM、Session、Tool、Policy 或 UI 实现。
