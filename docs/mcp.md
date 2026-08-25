# MCP Client

PiHarness 使用官方
[`@modelcontextprotocol/client`](https://github.com/modelcontextprotocol/typescript-sdk)
连接 MCP Server。插件支持 stdio 和 Streamable HTTP：

```js
import { mcpClientPlugin } from "@piharness/mcp-client";
import { plugin } from "@piharness/kernel";

plugin(mcpClientPlugin, {
  servers: [
    {
      id: "local-tools",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./server.js"],
      },
    },
    {
      id: "remote-api",
      transport: {
        type: "http",
        url: "https://example.com/mcp",
      },
    },
  ],
});
```

远端工具名会变为 `<server>__<tool>`，避免不同 Server 无意覆盖。`tools/list` 的 JSON
Schema 原样进入模型定义；`tools/call` 的结果被规范化为 PiHarness ContentBlock。

每次调用依然经过输入验证、Policy 和 Approval。默认 MCP 风险为 `external`，可在
Server 配置上显式改为 `read`、`workspace-write` 或 `dangerous`。请求的 AbortSignal
和可选超时会传入官方 SDK。

插件卸载时先撤销工具注册，再关闭 Client；官方 stdio Transport 负责终止其子进程。
