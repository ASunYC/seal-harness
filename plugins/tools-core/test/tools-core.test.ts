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
} from "@seal-harness/core";
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
  it("filters model schemas without changing execution reachability", async () => {
    const service = new PolicyToolService(policy({ outcome: "allow" }), undefined, async () => {});
    service.register(tool(async () => ({ content: [text("hidden but callable")] })));
    const dispose = service.filterModelDefinitions((definition) => definition.name !== "write");
    expect(service.definitions(request.sessionId)).toEqual([]);
    expect(service.definitions(request.sessionId, { includeHidden: true }).map((definition) => definition.name)).toEqual(["write"]);
    await expect(service.execute(request)).resolves.toEqual({ content: [text("hidden but callable")] });
    dispose(); expect(service.definitions(request.sessionId).map((definition) => definition.name)).toEqual(["write"]);
  });

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

  it("spills oversized plain text and returns a bounded head/tail locator preview", async () => {
    const saveText = vi.fn(async ({ content }: { content: string }) => ({ locator: "/private/full.txt", bytes: Buffer.byteLength(content), retrievalHint: "Read it." }));
    const service = new PolicyToolService(
      policy({ outcome: "allow" }),
      undefined,
      async () => {},
      180,
      { saveText },
    );
    service.register(tool(async () => ({ content: [text("0123456789abcdef")] })));

    const result = await service.execute(request);
    service.register({ ...tool(async () => ({ content: [text("0123456789abcdef".repeat(20))] })), name: "large" });
    const large = await service.execute({ ...request, name: "large" });
    expect(saveText).toHaveBeenCalledWith(expect.objectContaining({ content: "0123456789abcdef".repeat(20), owner: { sessionId: request.sessionId } }));
    expect(large.content[0]).toMatchObject({ text: expect.stringContaining("/private/full.txt") });
    expect(Buffer.byteLength((large.content[0] as { text: string }).text)).toBeLessThanOrEqual(180);
    expect(result).toEqual({ content: [text("0123456789abcdef")] });
  });

  it("keeps read, mixed content, and storage failures inline", async () => {
    const failing = { saveText: vi.fn(async () => { throw new Error("disk full"); }) };
    const service = new PolicyToolService(policy({ outcome: "allow" }), undefined, async () => {}, 8, failing);
    service.register(tool(async () => ({ content: [text("0123456789abcdef")] })));
    await expect(service.execute(request)).resolves.toEqual({ content: [text("0123456789abcdef")] });
  });

  it("exposes and executes Session-scoped tools only for their owner", async () => {
    const service = new PolicyToolService(policy({ outcome: "allow" }), undefined, async () => {});
    const other = sessionId("other");
    service.register(tool(async () => ({ content: [text("owned")] })), { ownerSession: request.sessionId });
    service.register(tool(async () => ({ content: [text("other")] })), { ownerSession: other });

    expect(service.definitions(request.sessionId).map((definition) => definition.name)).toEqual(["write"]);
    await expect(service.execute(request)).resolves.toEqual({ content: [text("owned")] });
    await expect(service.execute({ ...request, sessionId: sessionId("missing") })).rejects.toBeInstanceOf(Error);
  });

  it("intersects scoped restrictions while preserving scoped tool shadows", async () => {
    const service = new PolicyToolService(policy({ outcome: "allow" }), undefined, async () => {});
    service.register(tool(async () => ({ content: [text("global")] })));
    service.register({ ...tool(async () => ({ content: [text("local")] })), description: "Session variant" }, { ownerSession: request.sessionId });
    service.register({ ...tool(async () => ({ content: [text("other")] })), name: "read" });
    const liftAllow = service.restrict({ allow: ["write"] }, { ownerSession: request.sessionId });
    service.restrict({ deny: ["write"] }, { ownerSession: request.sessionId });
    expect(service.definitions(request.sessionId).map((definition) => definition.name)).toEqual(["write"]);
    await expect(service.execute(request)).resolves.toEqual({ content: [text("local")] });
    expect(service.definitions(request.sessionId).map((definition) => definition.name)).not.toContain("read");
    liftAllow();
  });

  it("runs monotonic global then scoped guards before policy and execution", async () => {
    const decide = vi.fn(async (): Promise<PolicyDecision> => ({ outcome: "allow" }));
    const execute = vi.fn(async () => ({ content: [text("done")] }));
    const service = new PolicyToolService({ decide }, undefined, async () => {}); service.register(tool(execute));
    service.guard(() => undefined); service.guard((execution) => execution.name === "write" ? "global guard" : undefined);
    service.guard(() => "scoped guard", { ownerSession: request.sessionId });
    await expect(service.execute(request)).rejects.toMatchObject({ reason: "global guard" });
    expect(decide).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("cooperatively times out and waits for the tool body to settle", async () => {
    let settled = false;
    const service = new PolicyToolService(policy({ outcome: "allow" }), undefined, async () => {});
    service.register({ ...tool(async (_input, context) => { await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => setTimeout(resolve, 5), { once: true })); settled = true; return { content: [text("late")] }; }), timeoutMs: 5 });
    await expect(service.execute(request)).resolves.toMatchObject({ isError: true, details: { code: "TOOL_TIMEOUT" } });
    expect(settled).toBe(true);
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
