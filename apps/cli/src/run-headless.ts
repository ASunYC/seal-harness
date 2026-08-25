import {
  agentServiceToken,
  text,
  type AgentPromptRequest,
  type AgentService,
  type RuntimeEvent,
} from "@piharness/core";
import type { Kernel } from "@piharness/kernel";

export interface HeadlessIo {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export interface HeadlessResult {
  readonly sessionId: string;
  readonly stopReason: string;
  readonly errorMessage?: string;
}

export async function runHeadless(
  kernel: Kernel<any>,
  request: AgentPromptRequest,
  io: HeadlessIo,
): Promise<HeadlessResult> {
  const agent = kernel.use(agentServiceToken) as AgentService;
  const execution = await agent.prompt(request);
  for await (const event of execution) renderEvent(event, io);
  const result = await execution.result;
  io.stdout.write("\n");
  return {
    sessionId: execution.sessionId,
    stopReason: result.runtime.stopReason,
    ...(result.runtime.errorMessage === undefined ? {} : { errorMessage: result.runtime.errorMessage }),
  };
}

function renderEvent(event: RuntimeEvent, io: HeadlessIo): void {
  switch (event.type) {
    case "text_delta":
      io.stdout.write(event.delta);
      break;
    case "tool_call":
      io.stderr.write(`\n→ ${event.call.name}\n`);
      break;
    case "tool_result":
      io.stderr.write(`← ${event.name}${event.result.isError === true ? " (error)" : ""}\n`);
      break;
  }
}

export function promptRequest(
  cwd: string,
  provider: string,
  model: string,
  prompt: string,
  options: Pick<AgentPromptRequest, "sessionId" | "reasoning" | "signal"> = {},
): AgentPromptRequest {
  return {
    cwd,
    model: { provider, model },
    prompt: [text(prompt)],
    ...options,
  };
}
