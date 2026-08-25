import {
  contextServiceToken,
  type AgentMessage,
  type ContextRequest,
  type ContextService,
  type ContextSource,
  type PiHarnessEvents,
  type PreparedContext,
  type UserMessage,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

export interface ContextCoreConfig {
  readonly systemPrompt?: string;
}

export class ContextRegistry implements ContextService {
  readonly #sources = new Map<string, ContextSource>();

  constructor(
    readonly baseSystemPrompt = "You are PiHarness, a concise and careful coding agent.",
  ) {}

  register(source: ContextSource): () => void {
    if (this.#sources.has(source.name)) {
      throw new Error(`Context source is already registered: ${source.name}`);
    }
    this.#sources.set(source.name, source);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#sources.get(source.name) === source) this.#sources.delete(source.name);
    };
  }

  async prepare(request: ContextRequest): Promise<PreparedContext> {
    request.signal.throwIfAborted();
    const sections = [this.baseSystemPrompt];
    const prompt: UserMessage = { role: "user", content: request.prompt };
    let additions: AgentMessage[] = [prompt];
    let messages: AgentMessage[] = [...request.history, prompt];
    for (const source of this.#sources.values()) {
      const contribution = await source.contribute(request, messages);
      if (contribution?.systemPrompt !== undefined && contribution.systemPrompt.length > 0) {
        sections.push(contribution.systemPrompt);
      }
      if (contribution?.messages !== undefined) {
        assertProjection(messages, contribution.messages, source.name);
        messages = [...contribution.messages];
      }
      if (contribution?.additions !== undefined && contribution.additions.length > 0) {
        const projectedPrompt = messages.at(-1);
        if (projectedPrompt === undefined) throw new Error("Context projection lost the prompt message");
        messages = [
          ...messages.slice(0, -1),
          ...contribution.additions,
          projectedPrompt,
        ];
        additions = [
          ...additions.slice(0, -1),
          ...contribution.additions,
          additions.at(-1) ?? prompt,
        ];
      }
    }
    return {
      systemPrompt: sections.join("\n\n"),
      messages,
      additions,
    };
  }
}

export const contextCorePlugin = definePlugin<ContextCoreConfig, PiHarnessEvents>({
  name: "context-core",
  provides: [contextServiceToken],
  setup(context, config) {
    context.provide(contextServiceToken, new ContextRegistry(config.systemPrompt));
  },
});

function assertProjection(
  previous: readonly AgentMessage[],
  projected: readonly AgentMessage[],
  sourceName: string,
): void {
  if (previous.length !== projected.length) {
    throw new Error(`Context source ${sourceName} changed message count`);
  }
  for (const [index, message] of previous.entries()) {
    if (message.role !== projected[index]?.role) {
      throw new Error(`Context source ${sourceName} changed message role at index ${index}`);
    }
  }
}
