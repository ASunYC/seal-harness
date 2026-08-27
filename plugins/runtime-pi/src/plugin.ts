import {
  modelServiceToken,
  runtimeToken,
  toolServiceToken,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
import { PiAgentRuntime, type PiRuntimeOptions } from "./runtime.js";

export const piRuntimePlugin = definePlugin<PiRuntimeOptions, SealHarnessEvents>({
  name: "runtime-pi",
  provides: [runtimeToken],
  requires: [modelServiceToken],
  optional: [toolServiceToken],
  setup(context, config) {
    const modelService = context.use(modelServiceToken);
    const toolService = context.has(toolServiceToken)
      ? context.use(toolServiceToken)
      : undefined;
    context.provide(runtimeToken, new PiAgentRuntime(modelService, toolService, config));
  },
});
