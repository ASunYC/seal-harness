import {
  modelServiceToken,
  type ModelInfo,
  type ModelRequest,
  type ModelService,
  type ModelStreamEvent,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface ScriptedModelConfig {
  readonly models: readonly ModelInfo[];
  readonly respond: (request: ModelRequest) => AsyncIterable<ModelStreamEvent>;
}

export class ScriptedModelService implements ModelService {
  constructor(readonly config: ScriptedModelConfig) {}

  async list(): Promise<readonly ModelInfo[]> { return this.config.models; }

  async get(ref: { provider: string; model: string }): Promise<ModelInfo | undefined> {
    return this.config.models.find((candidate) =>
      candidate.provider === ref.provider && candidate.model === ref.model,
    );
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    return this.config.respond(request);
  }
}

export const scriptedModelPlugin = definePlugin<ScriptedModelConfig, SealHarnessEvents>({
  name: "model-scripted",
  provides: [modelServiceToken],
  setup(context, config) {
    context.provide(modelServiceToken, new ScriptedModelService(config));
  },
});
