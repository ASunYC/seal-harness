# 设计

- `plugins/weknora/upstream/` 保留 npm 发布包原文件。产品 Host 入口 `src/index.js` 包装它的 `createTools` 和 REST Client；构建产物仍复制上游文件以核验来源。
- Host 按本机登录账号使用现有 `credentials` 服务保存连接地址与 API Key，沿现有 `connection.fetch` RPC 暴露不含密钥的状态、配置、清除和只读连接检查。变更地址时不把旧密钥自动发往新地址；请求完成前复核登录账号。
- 注册工具时使用按调用读取凭据的 Client 代理，因此配置更新不需要重新注册工具；工具元数据和检索逻辑继续由上游 `createTools` 提供。
- Client 设置同时提供 Seal 到 WeKnora 的连接表单及 WeKnora 原生模型配置页链接。后者管理向量/问答模型，前者只管理检索插件的服务连接。
