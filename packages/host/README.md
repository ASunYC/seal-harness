# @seal-harness/host

Seal Harness 的 Profile 发现、加载和启动层。

配置使用原生 ESM：`seal-harness.config.mjs` 默认导出插件实例数组。Host 不解析 YAML，
也不在运行时编译 TypeScript，从而保持启动路径精简且行为可预测。
