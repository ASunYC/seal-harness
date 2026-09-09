# @seal-harness/host

Seal Harness 的 Profile 发现、加载和启动层。

配置使用原生 ESM：`seal-harness.config.mjs` 默认导出插件实例数组。Host 不解析 YAML，
也不在运行时编译 TypeScript，从而保持启动路径精简且行为可预测。

`startProfile()` 会在任何插件启动前解析 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与
`NO_PROXY`（同时支持小写名称），安装进程级 Undici dispatcher，并在 Kernel 停止时恢复。
回环地址始终加入 bypass，避免 Web/RPC 自连接被送入外部代理；无有效代理时显式使用直连策略。
