import { describe, expect, it } from "vitest";
import {
  agentServiceToken,
  approvalServiceToken,
  attachmentServiceToken,
  compactionServiceToken,
  contextServiceToken,
  credentialServiceToken,
  messageId,
  modelServiceToken,
  policyServiceToken,
  runId,
  runtimeToken,
  sessionId,
  sessionStoreToken,
  toolCallId,
  toolServiceToken,
  telemetryServiceToken,
  turnId,
  userMessage,
} from "../src/index.js";

describe("core contracts", () => {
  it("exports stable, unique service tokens", () => {
    const tokens = [
      agentServiceToken,
      compactionServiceToken,
      modelServiceToken,
      runtimeToken,
      sessionStoreToken,
      toolServiceToken,
      policyServiceToken,
      approvalServiceToken,
      contextServiceToken,
      credentialServiceToken,
      telemetryServiceToken,
      attachmentServiceToken,
    ];

    expect(new Set(tokens.map((token) => token.id))).toHaveLength(tokens.length);
    expect(tokens.map((token) => token.name)).toEqual([
      "seal-harness.agent",
      "seal-harness.compaction",
      "seal-harness.model",
      "seal-harness.runtime",
      "seal-harness.session-store",
      "seal-harness.tools",
      "seal-harness.policy",
      "seal-harness.approval",
      "seal-harness.context",
      "seal-harness.credentials",
      "seal-harness.telemetry",
      "seal-harness.attachments",
    ]);
  });

  it("normalizes branded ids and rejects empty values", () => {
    expect(sessionId(" session ")).toBe("session");
    expect(runId("run")).toBe("run");
    expect(turnId("turn")).toBe("turn");
    expect(messageId("message")).toBe("message");
    expect(toolCallId("call")).toBe("call");
    expect(() => sessionId("  ")).toThrow(TypeError);
  });

  it("creates a canonical user text message", () => {
    expect(userMessage("hello")).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });
});
