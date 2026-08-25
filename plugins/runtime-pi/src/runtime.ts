import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage as PiAssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type {
  AgentMessage,
  AgentRun,
  AgentRuntime,
  ModelService,
  ModelStopReason,
  ModelUsage,
  RuntimeEvent,
  RuntimeResult,
  RuntimeStartRequest,
  ToolResult,
  ToolService,
} from "@piharness/core";
import { toolCallId } from "@piharness/core";
import { Type } from "typebox";
import { AsyncChannel } from "./async-channel.js";
import { createModelBridge, createPiModel } from "./model-bridge.js";
import { fromPiAssistantMessage, fromPiMessages, toPiMessage, toPiMessages } from "./messages.js";

export interface PiRuntimeOptions {
  readonly toolExecution?: "parallel" | "sequential";
  readonly steeringMode?: "all" | "one-at-a-time";
  readonly followUpMode?: "all" | "one-at-a-time";
}

export class PiAgentRuntime implements AgentRuntime {
  constructor(
    readonly modelService: ModelService,
    readonly toolService: ToolService | undefined,
    readonly options: PiRuntimeOptions = {},
  ) {}

  start(request: RuntimeStartRequest): AgentRun {
    return new PiAgentRun(this.modelService, this.toolService, this.options, request);
  }
}

class PiAgentRun implements AgentRun {
  readonly #channel = new AsyncChannel<RuntimeEvent>();
  readonly #abortController = new AbortController();
  readonly #pendingSteering: AgentMessage[] = [];
  readonly #pendingFollowUps: AgentMessage[] = [];
  #agent?: Agent;
  readonly result: Promise<RuntimeResult>;

  constructor(
    modelService: ModelService,
    toolService: ToolService | undefined,
    options: PiRuntimeOptions,
    readonly request: RuntimeStartRequest,
  ) {
    if (request.signal !== undefined) {
      if (request.signal.aborted) this.#abortController.abort(request.signal.reason);
      else request.signal.addEventListener("abort", () => this.abort(request.signal?.reason), { once: true });
    }
    this.result = this.#execute(modelService, toolService, options);
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return this.#channel[Symbol.asyncIterator]();
  }

  abort(reason?: unknown): void {
    if (!this.#abortController.signal.aborted) this.#abortController.abort(reason);
    this.#agent?.abort();
  }

  steer(message: AgentMessage): void {
    if (this.#agent === undefined) this.#pendingSteering.push(message);
    else this.#agent.steer(toPiMessage(message, this.#agent.state.model));
  }

  followUp(message: AgentMessage): void {
    if (this.#agent === undefined) this.#pendingFollowUps.push(message);
    else this.#agent.followUp(toPiMessage(message, this.#agent.state.model));
  }

  async #execute(
    modelService: ModelService,
    toolService: ToolService | undefined,
    options: PiRuntimeOptions,
  ): Promise<RuntimeResult> {
    let messages: readonly AgentMessage[] = this.request.messages;
    try {
      if (this.#abortController.signal.aborted) {
        this.#channel.push({ type: "run_end", stopReason: "aborted" });
        return { messages, stopReason: "aborted" };
      }

      const model = await createPiModel(
        modelService,
        this.request.model.provider,
        this.request.model.model,
      );
      const tools = toolService === undefined ? [] : createPiTools(toolService, this.request);
      const agent = new Agent({
        initialState: {
          systemPrompt: this.request.systemPrompt,
          model,
          thinkingLevel: this.request.reasoning ?? "off",
          tools,
          messages: toPiMessages(this.request.messages, model),
        },
        streamFn: createModelBridge(modelService),
        sessionId: this.request.sessionId,
        toolExecution: options.toolExecution ?? "parallel",
        steeringMode: options.steeringMode ?? "one-at-a-time",
        followUpMode: options.followUpMode ?? "one-at-a-time",
      });
      this.#agent = agent;
      const unsubscribe = agent.subscribe((event) => this.#handleEvent(event));
      this.#abortController.signal.addEventListener("abort", () => agent.abort(), { once: true });

      for (const message of this.#pendingSteering.splice(0)) agent.steer(toPiMessage(message, model));
      for (const message of this.#pendingFollowUps.splice(0)) agent.followUp(toPiMessage(message, model));

      await agent.continue();
      unsubscribe();
      messages = fromPiMessages(agent.state.messages);
      const lastAssistant = [...agent.state.messages].reverse().find(
        (message): message is PiAssistantMessage => message.role === "assistant",
      );
      const stopReason = lastAssistant === undefined
        ? (this.#abortController.signal.aborted ? "aborted" : "stop")
        : fromPiStopReason(lastAssistant.stopReason);
      const result: RuntimeResult = {
        messages,
        stopReason,
        ...(lastAssistant === undefined ? {} : { usage: fromPiUsage(lastAssistant.usage) }),
        ...(agent.state.errorMessage === undefined ? {} : { errorMessage: agent.state.errorMessage }),
      };
      this.#channel.push({ type: "run_end", stopReason });
      return result;
    } catch (error) {
      const stopReason = this.#abortController.signal.aborted ? "aborted" : "error";
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.#agent !== undefined) messages = fromPiMessages(this.#agent.state.messages);
      this.#channel.push({ type: "run_end", stopReason });
      return { messages, stopReason, errorMessage };
    } finally {
      this.#channel.close();
    }
  }

  #handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.#channel.push({ type: "run_start", runId: this.request.runId });
        break;
      case "turn_start":
        this.#turnIndex += 1;
        this.#channel.push({ type: "turn_start", index: this.#turnIndex });
        break;
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.#channel.push({ type: "text_delta", delta: event.assistantMessageEvent.delta });
        } else if (event.assistantMessageEvent.type === "thinking_delta") {
          this.#channel.push({ type: "reasoning_delta", delta: event.assistantMessageEvent.delta });
        } else if (event.assistantMessageEvent.type === "toolcall_end") {
          const call = event.assistantMessageEvent.toolCall;
          this.#channel.push({
            type: "tool_call",
            call: {
              type: "tool_call",
              id: toolCallId(call.id),
              name: call.name,
              arguments: call.arguments,
            },
          });
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          this.#channel.push({
            type: "assistant_message",
            message: fromPiAssistantMessage(event.message),
          });
        }
        break;
      case "tool_execution_start":
        break;
      case "tool_execution_update":
        this.#channel.push({
          type: "tool_progress",
          callId: toolCallId(event.toolCallId),
          content: fromPiToolContent(event.partialResult?.content ?? []),
        });
        break;
      case "tool_execution_end":
        this.#channel.push({
          type: "tool_result",
          callId: toolCallId(event.toolCallId),
          name: event.toolName,
          result: fromPiToolResult(event.result, event.isError),
        });
        break;
      case "turn_end": {
        const assistant = event.message.role === "assistant" ? event.message : undefined;
        this.#channel.push({
          type: "turn_end",
          index: this.#turnIndex,
          ...(assistant === undefined ? {} : { usage: fromPiUsage(assistant.usage) }),
        });
        break;
      }
      case "agent_end":
      case "message_start":
        break;
    }
  }

  #turnIndex = -1;
}

function createPiTools(toolService: ToolService, request: RuntimeStartRequest): AgentTool[] {
  return toolService.definitions().map((definition): AgentTool => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: Type.Unsafe({ ...definition.inputSchema }),
    async execute(callId, params, signal, onUpdate) {
      const result = await toolService.execute({
        callId: toolCallId(callId),
        sessionId: request.sessionId,
        cwd: request.cwd,
        name: definition.name,
        input: params as import("@piharness/core").JsonObject,
        signal: signal ?? new AbortController().signal,
        reportProgress: (content) => {
          onUpdate?.({ content: toPiToolContent(content), details: {} });
        },
      });
      if (result.isError === true) {
        throw new Error(result.content.map((block) => block.type === "text" ? block.text : `[${block.type}]`).join("\n"));
      }
      return {
        content: toPiToolContent(result.content),
        details: result.details ?? {},
      };
    },
  }));
}

function toPiToolContent(content: readonly import("@piharness/core").ContentBlock[]) {
  return content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (block.type === "image") {
      return { type: "image" as const, data: block.data, mimeType: block.mimeType };
    }
    return { type: "text" as const, text: `[attachment:${block.id}]` };
  });
}

function fromPiToolContent(content: readonly any[]): import("@piharness/core").ContentBlock[] {
  const converted: import("@piharness/core").ContentBlock[] = [];
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

function fromPiToolResult(result: any, isError: boolean): ToolResult {
  return {
    content: fromPiToolContent(result?.content ?? []),
    ...(result?.details === undefined ? {} : { details: result.details }),
    isError,
  };
}

function fromPiStopReason(reason: PiAssistantMessage["stopReason"]): ModelStopReason {
  if (reason === "toolUse" || reason === "deferred") return "tool_call";
  if (reason === "pending") return "stop";
  return reason;
}

function fromPiUsage(usage: Usage): ModelUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: usage.cost.total,
  };
}
