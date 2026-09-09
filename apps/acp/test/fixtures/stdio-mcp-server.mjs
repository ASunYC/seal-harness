import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({ name: "seal-acp-fixture", version: "1.0.0" });
server.registerTool(
  "echo",
  { description: "Echo a value", inputSchema: z.object({ value: z.string() }) },
  async ({ value }) => ({ content: [{ type: "text", text: `echo:${value}` }] }),
);
await server.connect(new StdioServerTransport());
