import { posix, win32 } from "node:path";
import { contextServiceToken, lspServiceToken, text, toolServiceToken, type JsonValue, type LspHover, type LspLocation, type LspOperation, type SealHarnessEvents, type ToolDefinition } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export const LSP_OPERATIONS = ["goToDefinition", "findReferences", "goToImplementation", "hover"] as const;
export const LSP_PROMPT_TEXT = "Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Positions are one-based line and character (UTF-16); findReferences includes declarations.";
export interface LspToolsConfig { readonly maxLocations?: number; readonly maxResultChars?: number; readonly timeoutMs?: number }

export const lspToolsPlugin = definePlugin<LspToolsConfig, SealHarnessEvents>({
  name: "lsp-tools", requires: [toolServiceToken, lspServiceToken, contextServiceToken],
  setup(context, config) {
    const resolved = { maxLocations: positive(config.maxLocations ?? 100, "maxLocations"), maxResultChars: positive(config.maxResultChars ?? 16_000, "maxResultChars"), timeoutMs: positive(config.timeoutMs ?? 60_000, "timeoutMs") };
    context.effect(context.use(contextServiceToken).register({ name: "lsp-guidance", async contribute() { return { systemPrompt: LSP_PROMPT_TEXT }; } }));
    context.effect(context.use(toolServiceToken).register(lspTool(context.use(lspServiceToken), resolved)));
  },
});

export function lspTool(service: import("@seal-harness/core").LspService, config: Required<LspToolsConfig>): ToolDefinition {
  return {
    name: "lsp",
    description: "Query a language server for goToDefinition, findReferences, goToImplementation, or hover. line and character are one-based UTF-16 coordinates.",
    inputSchema: { type: "object", additionalProperties: false, required: ["operation", "file_path", "line", "character"], properties: {
      operation: { type: "string", enum: [...LSP_OPERATIONS] }, file_path: { type: "string" }, line: { type: "integer", minimum: 1 }, character: { type: "integer", minimum: 1 },
    } },
    classify(input, ctx) { return { kind: "tool", toolName: "lsp", risk: "read", summary: `LSP ${String(input.operation)} ${String(input.file_path)}`, target: ctx.cwd }; },
    async execute(input, ctx) {
      const operation = parseOperation(input.operation);
      const filePath = requiredString(input.file_path, "file_path");
      const line = coordinate(input.line, "line");
      const character = coordinate(input.character, "character");
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const signal = AbortSignal.any([ctx.signal, timeout]);
      const result = await service.query({ operation, filePath, position: { line: line - 1, character: character - 1 }, workspaceRoot: ctx.cwd }, signal);
      const rendered = result.kind === "hover" ? formatHover(result.hover, config.maxResultChars) : formatLocations(result.locations, result.resolvedWorkspaceUri, config.maxLocations, config.maxResultChars);
      return { content: [text(rendered)], details: JSON.parse(JSON.stringify(result)) as JsonValue };
    },
  };
}

export function formatLocations(locations: readonly LspLocation[], workspaceUri: string, maxLocations: number, maxChars: number): string {
  if (locations.length === 0) return bound("No results.", maxChars, "locations");
  const lines = locations.slice(0, maxLocations).map((item) => `${renderUri(item.uri, workspaceUri)}:${item.range.start.line + 1}:${item.range.start.character + 1}`);
  const omitted = locations.length - lines.length;
  if (omitted > 0) lines.push(`… ${omitted} more location${omitted === 1 ? "" : "s"} omitted (limit ${maxLocations}).`);
  return bound(lines.join("\n"), maxChars, "locations");
}
export function formatHover(hover: LspHover | null, maxChars: number): string { return bound(hover?.contents ?? "No hover information.", maxChars, "hover"); }
export function renderUri(uri: string, workspaceUri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    const targetUrl = new URL(uri); const workspaceUrl = new URL(workspaceUri);
    const windows = /^\/[a-z]:/i.test(workspaceUrl.pathname) || workspaceUrl.hostname !== "";
    const pathApi = windows ? win32 : posix;
    const decoded = (url: URL) => { const value = decodeURIComponent(url.pathname); return windows && /^\/[a-z]:/i.test(value) ? value.slice(1).replaceAll("/", "\\") : value; };
    const target = decoded(targetUrl); const workspace = decoded(workspaceUrl); const rel = pathApi.relative(workspace, target);
    return rel !== "" && !rel.startsWith("..") && !pathApi.isAbsolute(rel) ? rel.replaceAll("\\", "/") : target.replaceAll("\\", "/");
  } catch { return uri; }
}
function bound(value: string, max: number, label: string): string { if (value.length <= max) return value; const notice = `\n… ${label} truncated (limit ${max} characters).`; return notice.length >= max ? notice.slice(0, max) : value.slice(0, max - notice.length) + notice; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`); return value; }
function requiredString(value: unknown, name: string): string { if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`); return value; }
function coordinate(value: unknown, name: string): number { if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${name} must be a positive integer (one-based)`); return value as number; }
function parseOperation(value: unknown): LspOperation { if (typeof value !== "string" || !(LSP_OPERATIONS as readonly string[]).includes(value)) throw new Error(`operation must be one of ${LSP_OPERATIONS.join(", ")}`); return value as LspOperation; }
