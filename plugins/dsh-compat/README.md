# @seal-harness/dsh-compat

Optional compatibility host for DeepSeek Harness plugins built on
`@deepseek-ai/cordis`.

The package runs plugins on a real Cordis `Context`. Function, class, object and module-style
plugins keep their Cordis `apply`, `inject`, `Config`, event, service, Fiber and Effect semantics.
The package is not part of the default Seal Harness Profile or self-contained launcher closure.

## Profile usage

```js
import * as myDshPlugin from "my-dsh-plugin";
import { dshCompatPlugin } from "@seal-harness/dsh-compat";
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";

export default defineProfile([
  // Add the normal Seal Harness model, session, context, policy, tools,
  // runtime and agent plugins first.
  plugin(dshCompatPlugin, {
    plugins: [{ plugin: myDshPlugin, config: {} }],
    defaultToolRisk: "external",
    toolRisks: { trusted_read_tool: "read" },
  }),
]);
```

Run the Profile with:

```sh
seal-harness --config ./seal-harness.config.mjs "Use the compatible plugin"
```

## Compatibility boundary

Supported:

- real Cordis plugin forms and `inject` dependency waiting;
- Standard Schema `Config` validation performed by Cordis;
- Cordis services, events, Fiber disposal and `ctx.effect()` cleanup;
- raw or `defineTool()`-produced DSH tools registered through `ctx.tools`;
- Seal Harness Policy and Approval routing for every bridged tool.

Not emulated:

- `cordis.yml`, loader tree, include/group plugins or HMR;
- DSH Web client plugins and Host/Client RPC surfaces;
- DSH Agent, Session, Workspace, Code Mode or scoped ToolRuntime objects;
- deferred DSH contexts and `concludeTurn()` semantics. They are retained in the Seal tool result
  `details` for diagnostics, but are not injected into the Seal Agent loop.

Plugins requiring additional named Cordis services can receive explicitly trusted adapters through
the `services` configuration field. A DSH plugin is trusted Node.js code and is not sandboxed by this
compatibility host.
