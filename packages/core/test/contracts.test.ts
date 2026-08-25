import { describe, expect, it } from "vitest";
import {
  approvalServiceToken,
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
  turnId,
  userMessage,
} from "../src/index.js";

describe("core contracts", () => {
  it("exports stable, unique service tokens", () => {
    const tokens = [
      modelServiceToken,
      runtimeToken,
      sessionStoreToken,
      toolServiceToken,
      policyServiceToken,
      approvalServiceToken,
      contextServiceToken,
      credentialServiceToken,
    ];

    expect(new Set(tokens.map((token) => token.id))).toHaveLength(tokens.length);
    expect(tokens.map((token) => token.name)).toEqual([
      "piharness.model",
      "piharness.runtime",
      "piharness.session-store",
      "piharness.tools",
      "piharness.policy",
      "piharness.approval",
      "piharness.context",
      "piharness.credentials",
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
