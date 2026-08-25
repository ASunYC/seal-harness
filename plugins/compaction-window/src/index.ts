import {
  compactionServiceToken,
  text,
  type AgentMessage,
  type CompactionRequest,
  type CompactionResult,
  type CompactionService,
  type PiHarnessEvents,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

export interface WindowCompactionConfig {
  readonly thresholdMessages?: number;
  readonly retainMessages?: number;
  readonly maxSummaryCharacters?: number;
  readonly maxMessageCharacters?: number;
}

export class WindowCompactionService implements CompactionService {
  readonly thresholdMessages: number;
  readonly retainMessages: number;
  readonly maxSummaryCharacters: number;
  readonly maxMessageCharacters: number;

  constructor(config: WindowCompactionConfig = {}) {
    this.thresholdMessages = positive(config.thresholdMessages ?? 40, "thresholdMessages");
    this.retainMessages = positive(config.retainMessages ?? 12, "retainMessages");
    this.maxSummaryCharacters = positive(config.maxSummaryCharacters ?? 12_000, "maxSummaryCharacters");
    this.maxMessageCharacters = positive(config.maxMessageCharacters ?? 1_000, "maxMessageCharacters");
  }

  async compact(request: CompactionRequest): Promise<CompactionResult | undefined> {
    request.signal.throwIfAborted();
    if (request.messages.length <= this.thresholdMessages) return undefined;

    const desiredStart = Math.max(1, request.messages.length - this.retainMessages);
    let retainStart = request.messages.findIndex((message, index) =>
      index >= desiredStart && message.role === "user",
    );
    if (retainStart < 0) {
      retainStart = desiredStart;
      while (retainStart > 0 && request.messages[retainStart]?.role !== "user") {
        retainStart -= 1;
      }
    }
    if (retainStart <= 0) return undefined;

    const dropped = request.messages.slice(0, retainStart);
    const retainedMessages = request.messages.slice(retainStart);
    const rendered = dropped.map((message, index) =>
      `${index + 1}. ${renderMessage(message, this.maxMessageCharacters)}`,
    ).join("\n");
    const summary = rendered.length <= this.maxSummaryCharacters
      ? rendered
      : `${rendered.slice(0, this.maxSummaryCharacters)}\n[summary truncated]`;
    return {
      summaryMessage: {
        role: "user",
        content: [text(`Compacted conversation history (${dropped.length} messages):\n${summary}`)],
      },
      retainedMessages,
    };
  }
}

export const windowCompactionPlugin = definePlugin<WindowCompactionConfig, PiHarnessEvents>({
  name: "compaction-window",
  provides: [compactionServiceToken],
  setup(context, config) {
    context.provide(compactionServiceToken, new WindowCompactionService(config));
  },
});

function renderMessage(message: AgentMessage, max: number): string {
  let value: string;
  if (message.role === "user") {
    value = `user: ${visibleText(message.content)}`;
  } else if (message.role === "tool") {
    value = `tool ${message.name}${message.isError ? " error" : ""}: ${visibleText(message.content)}`;
  } else {
    const parts = message.content.map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "reasoning") return "[reasoning omitted]";
      return `[tool call ${block.name}]`;
    });
    value = `assistant: ${parts.join(" ")}`;
  }
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function visibleText(content: readonly import("@piharness/core").ContentBlock[]): string {
  return content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "image") return `[image ${block.mimeType}]`;
    return `[attachment ${block.name ?? block.id}]`;
  }).join(" ");
}

function positive(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}
