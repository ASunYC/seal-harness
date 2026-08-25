import {
  contextServiceToken,
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
    const additions = [];
    for (const source of this.#sources.values()) {
      const contribution = await source.contribute(request);
      if (contribution?.systemPrompt !== undefined && contribution.systemPrompt.length > 0) {
        sections.push(contribution.systemPrompt);
      }
      if (contribution?.additions !== undefined) additions.push(...contribution.additions);
    }
    const prompt: UserMessage = { role: "user", content: request.prompt };
    additions.push(prompt);
    return {
      systemPrompt: sections.join("\n\n"),
      messages: [...request.history, ...additions],
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
