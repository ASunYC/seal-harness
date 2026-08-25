# 公共 API 概览

## `@piharness/kernel`

- `createServiceToken<T>(name)`：创建类型化服务标识。
- `definePlugin(definition)`：定义静态插件边界。
- `plugin(definition, config, options)`：创建 Profile 实例。
- `Kernel.start()` / `stop()`：启动和逆序卸载。
- `PluginContext`：`use`、`provide`、`on`、`emit`、`effect`、`signal`。

## `@piharness/core`

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

事件类型通过 `PiHarnessEvents` 统一，Session 使用 `SessionEventMap` 判别联合。公共
消息和模型接口不暴露 Pi 专有类型。

## `@piharness/host`

- `defineProfile(specs)`：冻结 Profile。
- `loadProfile({ cwd, configPath })`：发现并验证原生 ESM Profile。
- `startProfile(profile)`：创建并启动 Kernel。

完整类型定义以各包生成的 `.d.ts` 为准。公开符号由每个包的 `src/index.ts` 控制。
