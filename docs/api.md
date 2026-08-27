# 公共 API 概览

## `@seal-harness/kernel`

- `createServiceToken<T>(name)`：创建类型化服务标识。
- `definePlugin(definition)`：定义静态插件边界。
- `plugin(definition, config, options)`：创建 Profile 实例。
- `Kernel.start()` / `stop()`：启动和逆序卸载。
- `PluginContext`：`use`、`provide`、`on`、`emit`、`effect`、`signal`。

## `@seal-harness/core`

标准服务令牌：

| Token | Contract |
|---|---|
| `agentServiceToken` | `AgentService` |
| `attachmentServiceToken` | `AttachmentService` |
| `runtimeToken` | `AgentRuntime` |
| `modelServiceToken` | `ModelService` |
| `sessionStoreToken` | `SessionStore` |
| `toolServiceToken` | `ToolService` |
| `policyServiceToken` | `PolicyService` |
| `approvalServiceToken` | `ApprovalService` |
| `contextServiceToken` | `ContextService` |
| `compactionServiceToken` | `CompactionService` |
| `credentialServiceToken` | `CredentialService` |
| `telemetryServiceToken` | `TelemetryService` |

事件类型通过 `SealHarnessEvents` 统一，Session 使用 `SessionEventMap` 判别联合。公共
消息和模型接口不暴露 Pi 专有类型。

## `@seal-harness/host`

- `defineProfile(specs)`：冻结 Profile。
- `loadProfile({ cwd, configPath })`：发现并验证原生 ESM Profile。
- `startProfile(profile)`：创建并启动 Kernel。

## `@seal-harness/web`

- `startWebServer(options)`：启动本地 HTTP Host、静态 WebUI 和 Agent 流式 API；
- `WebApprovalService`：公开待审批请求并由浏览器决定 allow/deny；
- `runWebCli(argv, environment)`：`seal-harness web` 的可嵌入入口。

HTTP API 包含模型、Session、运行流、中止、审批和进程内 Credential 端点。运行响应
使用 `application/x-ndjson` 持续发送 RuntimeEvent。

## `@seal-harness/launcher`

- `runLauncher(argv, environment)`：分派 `run`、`headless` 和 `web` 产品模式。

完整类型定义以各包生成的 `.d.ts` 为准。公开符号由每个包的 `src/index.ts` 控制。
