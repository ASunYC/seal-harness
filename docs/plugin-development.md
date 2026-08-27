# 插件开发指南

## 最小插件

插件是一个静态声明能力边界的 TypeScript 对象：

```ts
import { createServiceToken, definePlugin, plugin } from "@seal-harness/kernel";

interface Clock {
  now(): Date;
}

export const clockToken = createServiceToken<Clock>("example.clock");

export const clockPlugin = definePlugin({
  name: "clock",
  provides: [clockToken],
  setup(context) {
    context.provide(clockToken, { now: () => new Date() });
  },
});

export const instance = plugin(clockPlugin, undefined);
```

`provides`、`requires` 和 `optional` 在任何插件启动前构成依赖图。缺失服务、重复
Provider 和循环依赖都会在执行插件代码之前失败。

## 生命周期和 Effect

通过 Context 注册的服务和事件监听器会自动绑定到当前插件作用域。其他资源必须
使用 `effect()` 登记清理：

```ts
setup(context) {
  const socket = openConnection();
  context.effect(() => socket.close());
}
```

同一插件的 Effect 按 LIFO 清理，插件按启动顺序的逆序卸载。`setup()` 也可以返回
一个最终 Disposer；它在作用域 Effect 清理完成后执行。启动失败会走相同回滚路径。

插件收到的 `context.signal` 在卸载开始时中止。后台任务必须监听该 Signal，不能让
Promise、计时器、文件监听器或子进程越过插件生命周期。

## 服务边界

标准令牌位于 `@seal-harness/core`：

- `agentServiceToken`
- `runtimeToken`
- `modelServiceToken`
- `sessionStoreToken`
- `toolServiceToken`
- `policyServiceToken`
- `approvalServiceToken`
- `contextServiceToken`
- `credentialServiceToken`

普通插件不得导入 Pi 类型。只有 `runtime-pi` 和 `provider-pi-ai` 适配边界允许依赖
`@earendil-works/pi-*`。

## 注册工具

工具插件依赖 `toolServiceToken`，并把注册返回的 Disposer 交给 Effect：

```ts
setup(context) {
  const tools = context.use(toolServiceToken);
  context.effect(tools.register({
    name: "hello",
    description: "Return a greeting",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    classify(input) {
      return {
        kind: "tool",
        toolName: "hello",
        risk: "read",
        summary: `Greet ${String(input.name)}`,
      };
    },
    async execute(input) {
      return { content: [{ type: "text", text: `Hello ${String(input.name)}` }] };
    },
  }));
}
```

任何 Runtime 都必须通过 `ToolService.execute()` 调用工具。该管线先验证 JSON Schema，
再执行 Policy 和 Approval；工具插件不能自行绕过它。

## Profile

生产配置使用原生 ESM，默认导出插件实例数组：

```js
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";

export default defineProfile([
  plugin(clockPlugin, undefined),
]);
```

Profile 不在运行时编译 TypeScript，也不解释带可执行标签的 YAML。需要 TypeScript
配置时，应在发布或启动前编译为 ESM。

## DeepSeek Harness / Cordis 插件

需要复用 DSH 插件时，安装可选包 `@seal-harness/dsh-compat`。兼容层运行真实
`@deepseek-ai/cordis` Context，并将 DSH `ctx.tools.register()` 注册的工具桥接到 Seal
Harness `ToolService`，所以工具仍会经过 JSON Schema、Policy 和 Approval 管线。

```js
import * as existingDshPlugin from "existing-dsh-plugin";
import { dshCompatPlugin } from "@seal-harness/dsh-compat";

export default defineProfile([
  // 其余 Seal Harness 能力插件……
  plugin(dshCompatPlugin, {
    plugins: [{ plugin: existingDshPlugin, config: {} }],
    defaultToolRisk: "external",
  }),
]);
```

支持 DSH 的函数、类、对象和 module namespace 插件，以及 `apply`、`inject`、Standard
Schema `Config`、Cordis Service/Event/Fiber/Effect。`cordis.yml` Loader、HMR、DSH Web
Client、Agent/Session/Workspace 宿主对象不由兼容层模拟。完整边界见
[`docs/dsh-compatibility.md`](./dsh-compatibility.md)。

## 测试要求

每个能力插件至少验证：

- 正常注册和卸载；
- 缺失依赖或非法配置；
- Abort/错误路径；
- 不产生未登记的后台资源；
- 安全相关插件的失败关闭行为。
