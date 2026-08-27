import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { sessionId, type ToolPolicyAction } from "@seal-harness/core";
import { BasicPolicyService } from "../src/index.js";

const workspace = resolve("test-workspace");
const context = { sessionId: sessionId("session"), cwd: workspace };

describe("BasicPolicyService", () => {
  it("allows reads and in-workspace writes in workspace-write mode", async () => {
    const policy = new BasicPolicyService();
    expect(await policy.decide(action("read"), context)).toEqual({ outcome: "allow" });
    expect(await policy.decide(action("workspace-write", join("src", "index.ts")), context))
      .toEqual({ outcome: "allow" });
  });

  it("denies writes outside the workspace", async () => {
    const policy = new BasicPolicyService();
    expect(await policy.decide(action("workspace-write", resolve(workspace, "..", "secret.txt")), context))
      .toMatchObject({ outcome: "deny" });
  });

  it("denies reads outside the workspace unless explicitly enabled", async () => {
    const outside = resolve(workspace, "..", "secret.txt");
    expect(await new BasicPolicyService().decide(action("read", outside), context))
      .toMatchObject({ outcome: "deny" });
    expect(await new BasicPolicyService({ allowReadOutsideWorkspace: true }).decide(action("read", outside), context))
      .toEqual({ outcome: "allow" });
  });

  it("asks for dangerous and external operations by default", async () => {
    const policy = new BasicPolicyService();
    expect(await policy.decide(action("dangerous"), context)).toMatchObject({ outcome: "ask" });
    expect(await policy.decide(action("external"), context)).toMatchObject({ outcome: "ask" });
  });

  it("enforces read-only and danger-full-access presets", async () => {
    expect(await new BasicPolicyService({ mode: "read-only" }).decide(action("workspace-write"), context))
      .toMatchObject({ outcome: "deny" });
    expect(await new BasicPolicyService({ mode: "danger-full-access" }).decide(action("dangerous"), context))
      .toEqual({ outcome: "allow" });
  });
});

function action(risk: ToolPolicyAction["risk"], target?: string): ToolPolicyAction {
  return {
    kind: "tool",
    toolName: "test",
    risk,
    summary: `${risk} action`,
    ...(target === undefined ? {} : { target }),
  };
}
