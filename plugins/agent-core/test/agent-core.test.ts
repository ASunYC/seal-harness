import { describe, expect, it } from "vitest";
import {
  sessionId,
  text,
  userMessage,
  type AgentMessage,
  type AgentRun,
  type AgentRuntime,
  type ContextService,
  type RuntimeEvent,
  type RuntimeResult,
} from "@piharness/core";
import { MemorySessionStore } from "@piharness/session-memory";
import { DefaultAgentService } from "../src/index.js";

describe("DefaultAgentService", () => {
  it("persists additions before runtime and generated messages after completion", async () => {
    const sessions = new MemorySessionStore(() => new Date("2026-01-01T00:00:00Z"));
    const context: ContextService = {
      async prepare(request) {
        const addition = { role: "user" as const, content: request.prompt };
        return {
          systemPrompt: "test",
          messages: [...request.history, addition],
          additions: [addition],
        };
      },
    };
    let observedVersion = 0;
    const runtime: AgentRuntime = {
      start(request) {
        return completedRun(async () => {
          observedVersion = (await sessions.read(request.sessionId))?.version ?? 0;
          return {
            messages: [...request.messages, {
              role: "assistant",
              content: [text("done")],
            }],
            stopReason: "stop",
          };
        });
      },
    };
    const ids = ["run", "user-message", "assistant-message"];
    const service = new DefaultAgentService(
      sessions,
      context,
      runtime,
      async () => {},
      () => ids.shift() ?? "fallback",
    );

    const execution = await service.prompt({
      sessionId: sessionId("session"),
      cwd: "/workspace",
      model: { provider: "test", model: "test" },
      prompt: [text("hello")],
    });
    const result = await execution.result;

    expect(observedVersion).toBe(3);
    expect(result.session.version).toBe(5);
    expect(result.session.events.map((entry) => entry.event.type)).toEqual([
      "session.created",
      "message.appended",
      "run.started",
      "message.appended",
      "run.completed",
    ]);
  });
});

function completedRun(factory: () => Promise<RuntimeResult>): AgentRun {
  return {
    result: factory(),
    abort() {},
    steer(_message: AgentMessage) {},
    followUp(_message: AgentMessage) {},
    async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {},
  };
}
