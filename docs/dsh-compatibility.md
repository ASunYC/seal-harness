# DeepSeek Harness 插件兼容

Seal Harness 通过可选包 `@seal-harness/dsh-compat` 运行基于
`@deepseek-ai/cordis` 的 DSH 插件。兼容层使用真实 Cordis 4.0.1，而不是重新实现一个
只有表面相似的 `ctx` 对象。

## 安装和加载

```sh
pnpm add @seal-harness/dsh-compat
```

在原生 ESM Profile 中导入 DSH 插件模块：

```js
import * as myDshPlugin from "my-dsh-plugin";
import { dshCompatPlugin } from "@seal-harness/dsh-compat";
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";

export default defineProfile([
  // model/session/context/policy/tools/runtime/agent 插件……
  plugin(dshCompatPlugin, {
    plugins: [{ plugin: myDshPlugin, config: {} }],
    defaultToolRisk: "external",
    toolRisks: { known_read_tool: "read" },
  }),
]);
```

```sh
seal-harness --config ./seal-harness.config.mjs "Use the DSH plugin"
```

## 已兼容

| DSH/Cordis 能力 | 行为 |
|---|---|
| 函数、类、`{ apply }`、module namespace | 交给 Cordis 原生 Registry 加载 |
| `inject` | 服务出现后激活；服务消失时卸载；再次出现时重新激活 |
| Standard Schema `Config` | Cordis 在插件执行前验证并应用转换结果 |
| Service、Event、Fiber、Effect | 使用真实 Cordis 生命周期和作用域 |
| `ctx.tools.register()` | 转换为 Seal ToolDefinition 并自动随 Fiber 注销 |
| DSH `defineTool()` 结果 | 使用其 JSON Schema、execute、output.render 与 finalizeContent |
| 工具安全 | 统一经过 Seal JSON Schema、Policy、Approval 和结果大小限制 |

兼容层默认把 DSH 工具分类为 `external`，因此默认需要审批。只有明确了解工具行为后，
才应通过 `toolRisks` 把单个工具调整为 `read` 或 `workspace-write`。

## 可注入服务

插件声明了兼容层没有内置桥接的 `inject` 时，可以显式提供受信任适配器：

```js
plugin(dshCompatPlugin, {
  services: {
    metrics: myMetricsAdapter,
  },
  plugins: [{ plugin: metricsConsumer }],
});
```

`tools` 名称在 Seal `ToolService` 存在时由兼容层保留，不能被配置覆盖。

## 明确不兼容

- `cordis.yml` Loader 树、include/group 配置和 HMR；
- DSH Web Client 插件以及 Host/Client RPC 表面；
- 依赖 DSH Agent、Session、Workspace、Storage、Code Runtime 或 scoped ToolRuntime 的
  第一方插件，除非调用者为所有 `inject` 服务提供适配器；
- DSH 工具的 `deferContext()` 和 `concludeTurn()` 对 Agent loop 的控制语义。兼容层会把
  这些请求保留在 Seal ToolResult `details` 中，供诊断使用，但不会改变 Seal Agent loop；
- Cordis 插件 Loader 的运行时安装、源码编译和热替换。

## 安全

DSH 插件与 Seal 原生插件一样，是拥有 Node.js 进程权限的可信代码。Policy/Approval
保护的是模型通过 ToolService 发起的工具调用，不能隔离插件在 `apply()` 中直接执行的
文件、网络或子进程操作。只安装可信来源的插件；需要进程级隔离时使用容器或单独进程。
