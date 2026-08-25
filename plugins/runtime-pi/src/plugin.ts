import {
  modelServiceToken,
  runtimeToken,
  toolServiceToken,
  type PiHarnessEvents,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";
import { PiAgentRuntime, type PiRuntimeOptions } from "./runtime.js";

export const piRuntimePlugin = definePlugin<PiRuntimeOptions, PiHarnessEvents>({
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
