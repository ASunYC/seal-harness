import { describe, expect, it } from "vitest";
import { sessionId, text, userMessage } from "@piharness/core";
import { WindowCompactionService } from "../src/index.js";

describe("WindowCompactionService", () => {
  it("compacts old history and retains from a user boundary", async () => {
    const service = new WindowCompactionService({ thresholdMessages: 4, retainMessages: 2 });
    const messages = [
      userMessage("one"),
      { role: "assistant" as const, content: [text("answer one")] },
      userMessage("two"),
      { role: "assistant" as const, content: [text("answer two")] },
      userMessage("three"),
      { role: "assistant" as const, content: [text("answer three")] },
    ];
    const result = await service.compact({
      sessionId: sessionId("session"),
      messages,
      signal: new AbortController().signal,
    });

    expect(result?.summaryMessage).toMatchObject({ role: "user" });
    expect(result?.retainedMessages).toEqual(messages.slice(4));
    expect(result?.summaryMessage.content[0]).toMatchObject({
      text: expect.stringContaining("answer two"),
    });
  });

  it("does nothing below threshold", async () => {
    const service = new WindowCompactionService({ thresholdMessages: 4 });
    await expect(service.compact({
      sessionId: sessionId("session"),
      messages: [userMessage("one")],
      signal: new AbortController().signal,
    })).resolves.toBeUndefined();
  });
});
