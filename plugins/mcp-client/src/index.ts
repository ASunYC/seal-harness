import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool as McpTool,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  text,
  toolServiceToken,
  type ContentBlock,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type SealHarnessEvents,
  type ToolDefinition,
  type ToolRisk,
  type ToolService,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export type McpTransportConfig =
  | {
      readonly type: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "http";
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    };

export interface McpServerConfig {
  readonly id: string;
  readonly transport: McpTransportConfig;
  readonly toolPrefix?: string;
  readonly risk?: ToolRisk;
  readonly timeoutMs?: number;
}

export interface McpClientConfig {
  readonly servers: readonly McpServerConfig[];
}

export interface McpClientLike {
  listTools(): Promise<{ tools: readonly McpTool[] }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

export const mcpClientPlugin = definePlugin<McpClientConfig, SealHarnessEvents>({
  name: "mcp-client",
  requires: [toolServiceToken],
  async setup(context, config) {
    const toolService = context.use(toolServiceToken);
    for (const server of config.servers) {
      const client = await connectServer(server);
      // Registered tools unwind before the connection closes.
      context.effect(() => client.close());
      for (const dispose of await registerMcpTools(client, server, toolService)) {
        context.effect(dispose);
      }
    }
  },
});

export async function registerMcpTools(
  client: McpClientLike,
  server: McpServerConfig,
  toolService: ToolService,
): Promise<Array<() => void>> {
  const { tools } = await client.listTools();
  const prefix = sanitizeName(server.toolPrefix ?? server.id);
  return tools.map((tool) => {
    const exposedName = `${prefix}__${sanitizeName(tool.name)}`;
    const definition: ToolDefinition = {
      name: exposedName,
      description: `[MCP ${server.id}] ${tool.description ?? tool.name}`,
      inputSchema: normalizeSchema(tool.inputSchema),
      classify(input) {
        return {
          kind: "tool",
          toolName: exposedName,
          risk: server.risk ?? "external",
          summary: `Call MCP tool ${server.id}/${tool.name}`,
          metadata: { serverId: server.id, remoteTool: tool.name },
        };
      },
      async execute(input, context) {
        const result = await client.callTool(
          { name: tool.name, arguments: { ...input } },
          {
            signal: context.signal,
            ...(server.timeoutMs === undefined ? {} : { timeout: server.timeoutMs }),
          },
        );
        return {
          content: normalizeContent(result.content),
          ...(result.structuredContent === undefined
            ? {}
            : { details: normalizeJson(result.structuredContent) }),
          isError: result.isError === true,
        };
      },
    };
    return toolService.register(definition);
  });
}

async function connectServer(config: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: "seal-harness", version: "0.1.0" });
  if (config.transport.type === "stdio") {
    await client.connect(new StdioClientTransport({
      command: config.transport.command,
      ...(config.transport.args === undefined ? {} : { args: [...config.transport.args] }),
      ...(config.transport.cwd === undefined ? {} : { cwd: config.transport.cwd }),
      ...(config.transport.env === undefined ? {} : { env: { ...config.transport.env } }),
      stderr: "inherit",
    }));
  } else {
    const url = new URL(config.transport.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported MCP URL protocol: ${url.protocol}`);
    }
    await client.connect(new StreamableHTTPClientTransport(url, {
      ...(config.transport.headers === undefined
        ? {}
        : { requestInit: { headers: { ...config.transport.headers } } }),
    }));
  }
  return client;
}

function sanitizeName(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  if (sanitized.length === 0) throw new Error(`Invalid MCP tool namespace: ${value}`);
  return sanitized;
}

function normalizeSchema(value: unknown): JsonSchema {
  const normalized = normalizeJson(value);
  if (typeof normalized !== "object" || normalized === null || Array.isArray(normalized)) {
    throw new Error("MCP tool inputSchema must be a JSON object");
  }
  return normalized as JsonObject;
}

function normalizeContent(content: readonly unknown[]): ContentBlock[] {
  return content.map((block) => {
    if (typeof block !== "object" || block === null) return text(String(block));
    const value = block as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") {
      return text(value.text);
    }
    if (
      value.type === "image"
      && typeof value.data === "string"
      && typeof value.mimeType === "string"
    ) {
      return { type: "image", data: value.data, mimeType: value.mimeType };
    }
    return text(`[MCP content ${String(value.type ?? "unknown")}] ${JSON.stringify(normalizeJson(value))}`);
  });
}

function normalizeJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
