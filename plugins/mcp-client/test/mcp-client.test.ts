import { describe, expect, it, vi } from "vitest";
import { sessionId, toolCallId, type ToolDefinition, type ToolService } from "@piharness/core";
import { registerMcpTools, type McpClientLike, type McpServerConfig } from "../src/index.js";

describe("MCP client plugin", () => {
  it("namespaces remote tools and routes calls through ToolService definitions", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "remote result" }],
      structuredContent: { count: 1 },
    }));
    const client: McpClientLike = {
      async listTools() {
        return {
          tools: [{
            name: "lookup-order",
            description: "Look up an order",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          }],
        };
      },
      callTool,
      async close() {},
    };
    let registered: ToolDefinition | undefined;
    const tools: ToolService = {
      register(tool) {
        registered = tool;
        return () => { registered = undefined; };
      },
      definitions: () => [],
      async execute() { throw new Error("not used"); },
    };
    const server: McpServerConfig = {
      id: "orders api",
      transport: { type: "http", url: "https://example.test/mcp" },
    };

    const disposers = await registerMcpTools(client, server, tools);
    expect(registered?.name).toBe("orders_api__lookup-order");
    expect(registered?.classify({ id: "A-1" }, {
      callId: toolCallId("call"),
      sessionId: sessionId("session"),
      cwd: process.cwd(),
      signal: new AbortController().signal,
    })).toMatchObject({ risk: "external" });

    const result = await registered?.execute({ id: "A-1" }, {
      callId: toolCallId("call"),
      sessionId: sessionId("session"),
      cwd: process.cwd(),
      signal: new AbortController().signal,
      reportProgress() {},
    });
    expect(callTool).toHaveBeenCalledWith(
      { name: "lookup-order", arguments: { id: "A-1" } },
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "remote result" }],
      details: { count: 1 },
      isError: false,
    });
    disposers.forEach((dispose) => dispose());
    expect(registered).toBeUndefined();
  });
});
