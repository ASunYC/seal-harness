import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage as PiAssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { AgentMessage, RuntimeStartRequest, ToolService, ToolResult, ModelStopReason, ModelUsage } from "@seal-harness/core";
import { toolCallId } from "@seal-harness/core";
import { Type } from "typebox";
export function createPiTools(
  toolService: ToolService,
  request: RuntimeStartRequest,
  control: { concludesTurn: boolean; errors: Map<string, boolean> },
  injectContext: (message: AgentMessage) => void,
  reportDispatch: (event: import("@seal-harness/core").ToolDispatchEvent) => Promise<void>,
): AgentTool[] {
  return toolService.definitions(request.sessionId).map((definition): AgentTool => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: Type.Unsafe({ ...definition.inputSchema }),
    async execute(callId, params, signal, onUpdate) {
      let partialOutput: import("@seal-harness/core").ContentBlock[] = [];
      const result = await toolService.execute({
        callId: toolCallId(callId),
        sessionId: request.sessionId,
        cwd: request.cwd,
        name: definition.name,
        input: params as import("@seal-harness/core").JsonObject,
        signal: signal ?? new AbortController().signal,
        reportProgress: (content) => {
          let remaining = 50_000;
          partialOutput = [];
          for (const block of content) {
            if (block.type !== "text" || remaining <= 0) continue;
            const value = block.text.slice(0, remaining); remaining -= value.length;
            partialOutput.push({ type: "text", text: value });
          }
          onUpdate?.({ content: toPiToolContent(content), details: {} });
        },
        reportDispatch,
      }).catch((error): import("@seal-harness/core").ToolResult => {
        if (partialOutput.length === 0) throw error;
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}\nPartial output before failure (may be incomplete):` }, ...partialOutput],
          details: { partialOutput: true, interrupted: signal?.aborted === true },
        };
      });
      control.errors.set(callId, result.isError === true);
      for (const message of result.additionalContexts ?? []) injectContext(message);
      if (result.concludesTurn === true) control.concludesTurn = true;
      return {
        content: toPiToolContent(result.content),
        details: result.details ?? {},
      };
    },
  }));
}

function toPiToolContent(content: readonly import("@seal-harness/core").ContentBlock[]) {
  return content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (block.type === "image") {
      return { type: "image" as const, data: block.data, mimeType: block.mimeType };
    }
    return { type: "text" as const, text: `[attachment:${block.id}]` };
  });
}

export function fromPiToolContent(content: readonly any[]): import("@seal-harness/core").ContentBlock[] {
  const converted: import("@seal-harness/core").ContentBlock[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      converted.push({ type: "text", text: block.text });
      continue;
    }
    if (block?.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
      converted.push({ type: "image", data: block.data, mimeType: block.mimeType });
    }
  }
  return converted;
}

export function fromPiToolResult(result: any, isError: boolean): ToolResult {
  return {
    content: fromPiToolContent(result?.content ?? []),
    ...(result?.details === undefined ? {} : { details: result.details }),
    isError,
  };
}

export function fromPiStopReason(reason: PiAssistantMessage["stopReason"]): ModelStopReason {
  if (reason === "toolUse" || reason === "deferred") return "tool_call";
  if (reason === "pending") return "stop";
  return reason;
}

export function fromPiUsage(usage: Usage): ModelUsage {
  const routes = (usage as Usage & { readonly sealRoutes?: readonly import("@seal-harness/core").ModelRef[] }).sealRoutes;
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
    ...(routes === undefined ? {} : { routes }),
    costUsd: usage.cost.total,
  };
}
