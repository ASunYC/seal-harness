import {
  ApprovalUnavailableError,
  approvalServiceToken,
  DuplicateToolError,
  InvalidToolInputError,
  policyServiceToken,
  ToolDeniedError,
  ToolNotFoundError,
  toolServiceToken,
  type ApprovalService,
  type ModelToolDefinition,
  type PiHarnessEvents,
  type PolicyService,
  type ToolDefinition,
  type ToolExecutionRequest,
  type ToolResult,
  type ToolService,
} from "@piharness/core";
import { definePlugin, type PluginContext } from "@piharness/kernel";
import { Type } from "typebox";
import { Check } from "typebox/value";

export interface ToolsCoreConfig {}

export class PolicyToolService implements ToolService {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(
    readonly policy: PolicyService,
    readonly approval: ApprovalService | undefined,
    readonly emit: PluginContext<PiHarnessEvents>["emit"],
  ) {}

  register(tool: ToolDefinition): () => void {
    if (this.#tools.has(tool.name)) throw new DuplicateToolError(tool.name);
    this.#tools.set(tool.name, tool);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#tools.get(tool.name) === tool) this.#tools.delete(tool.name);
    };
  }

  definitions(): readonly ModelToolDefinition[] {
    return [...this.#tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const tool = this.#tools.get(request.name);
    if (tool === undefined) throw new ToolNotFoundError(request.name);
    if (!Check(Type.Unsafe({ ...tool.inputSchema }), request.input)) {
      throw new InvalidToolInputError(request.name);
    }

    const context = {
      callId: request.callId,
      sessionId: request.sessionId,
      cwd: request.cwd,
      signal: request.signal,
    };
    const action = tool.classify(request.input, context);
    const decision = await this.policy.decide(action, {
      sessionId: request.sessionId,
      cwd: request.cwd,
    });
    await this.emit("policy.decided", {
      sessionId: request.sessionId,
      action,
      decision,
    });

    if (decision.outcome === "deny") {
      throw new ToolDeniedError(request.name, decision.reason);
    }
    if (decision.outcome === "ask") {
      if (this.approval === undefined) throw new ApprovalUnavailableError(request.name);
      const approved = await this.approval.request({
        title: `Allow tool: ${request.name}`,
        message: decision.reason,
        ...(decision.details === undefined ? {} : { details: decision.details }),
        signal: request.signal,
      });
      if (!approved) throw new ToolDeniedError(request.name, "Approval declined");
    }

    const result = await tool.execute(request.input, {
      ...context,
      reportProgress: request.reportProgress ?? (() => {}),
    });
    await this.emit("tool.completed", {
      sessionId: request.sessionId,
      toolName: request.name,
      result,
    });
    return result;
  }
}

export const toolsCorePlugin = definePlugin<ToolsCoreConfig, PiHarnessEvents>({
  name: "tools-core",
  provides: [toolServiceToken],
  requires: [policyServiceToken],
  optional: [approvalServiceToken],
  setup(context) {
    const approval = context.has(approvalServiceToken)
      ? context.use(approvalServiceToken)
      : undefined;
    context.provide(
      toolServiceToken,
      new PolicyToolService(context.use(policyServiceToken), approval, context.emit),
    );
  },
});
