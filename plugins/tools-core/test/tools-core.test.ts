import { describe, expect, it, vi } from "vitest";
import {
  ApprovalUnavailableError,
  InvalidToolInputError,
  sessionId,
  text,
  ToolDeniedError,
  toolCallId,
  type ApprovalService,
  type PolicyDecision,
  type PolicyService,
  type ToolDefinition,
} from "@piharness/core";
import { PolicyToolService } from "../src/index.js";

const request = {
  callId: toolCallId("call"),
  sessionId: sessionId("session"),
  cwd: "/workspace",
  name: "write",
  input: { path: "file.txt" },
  signal: new AbortController().signal,
};

describe("PolicyToolService", () => {
  it("validates, authorizes, executes, and emits", async () => {
    const execute = vi.fn(async () => ({ content: [text("done")] }));
    const emit = vi.fn(async () => {});
    const service = new PolicyToolService(policy({ outcome: "allow" }), undefined, emit);
    service.register(tool(execute));

    await expect(service.execute(request)).resolves.toEqual({ content: [text("done")] });
    expect(execute).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("policy.decided", expect.any(Object));
    expect(emit).toHaveBeenCalledWith("tool.completed", expect.any(Object));
  });

  it("fails closed on invalid input and denied policy", async () => {
    const execute = vi.fn(async () => ({ content: [text("done")] }));
    const denied = new PolicyToolService(policy({ outcome: "deny", reason: "blocked" }), undefined, async () => {});
    denied.register(tool(execute));

    await expect(denied.execute({ ...request, input: {} })).rejects.toBeInstanceOf(InvalidToolInputError);
    await expect(denied.execute(request)).rejects.toBeInstanceOf(ToolDeniedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a positive approval for ask decisions", async () => {
    const execute = vi.fn(async () => ({ content: [text("done")] }));
    const withoutApproval = new PolicyToolService(
      policy({ outcome: "ask", reason: "confirm" }),
      undefined,
      async () => {},
    );
    withoutApproval.register(tool(execute));
    await expect(withoutApproval.execute(request)).rejects.toBeInstanceOf(ApprovalUnavailableError);

    const approval: ApprovalService = { request: vi.fn(async () => false) };
    const declined = new PolicyToolService(
      policy({ outcome: "ask", reason: "confirm" }),
      approval,
      async () => {},
    );
    declined.register(tool(execute));
    await expect(declined.execute(request)).rejects.toBeInstanceOf(ToolDeniedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("truncates arbitrary plugin results at the common tool boundary", async () => {
    const service = new PolicyToolService(
      policy({ outcome: "allow" }),
      undefined,
      async () => {},
      8,
    );
    service.register(tool(async () => ({ content: [text("0123456789abcdef")] })));

    const result = await service.execute(request);
    expect(result.content[0]).toEqual({ type: "text", text: "01234567" });
    expect(result.content[1]).toMatchObject({
      text: expect.stringContaining("truncated at 8 bytes"),
    });
  });
});

function policy(decision: PolicyDecision): PolicyService {
  return { async decide() { return decision; } };
}

function tool(execute: ToolDefinition["execute"]): ToolDefinition {
  return {
    name: "write",
    description: "Write a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    classify(input) {
      return {
        kind: "tool",
        toolName: "write",
        risk: "workspace-write",
        summary: "Write file",
        target: String(input.path),
      };
    },
    execute,
  };
}
