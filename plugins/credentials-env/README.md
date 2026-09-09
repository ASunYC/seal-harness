# @seal-harness/credentials-env

从环境变量按请求解析凭据。凭据不会复制进 Profile、事件或 Session。

配置 `path` 后，该服务还提供 DeepSeekHarness 风格的本地持久化凭据引用。启动环境
始终具有最高优先级且不可被文件写入覆盖；本地文档以仅所有者可读的临时文件原子替换，
`describeRef` 只公开来源与可写状态，不返回秘密值。默认 CLI 使用
`.seal-harness/credentials.json`。

同一文档也保存结构化 `api-key` 与 JSON `grant` 记录，并提供读取、描述、枚举、原子
read-modify-write 和删除接口，供认证插件轮换密钥或刷新授权令牌。

默认监视凭据文档的外部修改并发布引用/记录级更新事件；无效编辑不会清空当前内存
状态。可用 `watch: false` 关闭监视，并通过 `debounceMs`、`lockWaitMs` 调整热加载与
跨进程写锁行为。
