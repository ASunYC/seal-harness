import { createInterface } from "node:readline/promises";
import {
  approvalServiceToken,
  type ApprovalRequest,
  type ApprovalService,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface StdioApprovalConfig {
  readonly mode?: "ask" | "allow" | "deny";
}

export class StdioApprovalService implements ApprovalService {
  constructor(
    readonly mode: "ask" | "allow" | "deny" = "ask",
    readonly input: NodeJS.ReadableStream = process.stdin,
    readonly output: NodeJS.WritableStream = process.stderr,
  ) {}

  async request(request: ApprovalRequest): Promise<boolean> {
    request.signal.throwIfAborted();
    if (this.mode === "allow") return true;
    if (this.mode === "deny") return false;
    if ((this.input as NodeJS.ReadStream).isTTY !== true || (this.output as NodeJS.WriteStream).isTTY !== true) {
      return false;
    }

    const readline = createInterface({ input: this.input, output: this.output });
    try {
      const answer = await readline.question(
        `\n${request.title}\n${request.message}\nAllow? [y/N] `,
        { signal: request.signal },
      );
      return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
    } finally {
      readline.close();
    }
  }
}

export const stdioApprovalPlugin = definePlugin<StdioApprovalConfig, SealHarnessEvents>({
  name: "approval-stdio",
  provides: [approvalServiceToken],
  setup(context, config) {
    context.provide(approvalServiceToken, new StdioApprovalService(config.mode));
  },
});
