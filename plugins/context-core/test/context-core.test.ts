import { describe, expect, it } from "vitest";
import { sessionId, text } from "@seal-harness/core";
import { ContextRegistry } from "../src/index.js";

describe("ContextRegistry", () => {
  it("composes ordered sources and keeps all additions as the exact suffix", async () => {
    const registry = new ContextRegistry("base");
    registry.register({
      name: "one",
      async contribute() {
        return { systemPrompt: "section one" };
      },
    });
    registry.register({
      name: "two",
      async contribute() {
        return {
          systemPrompt: "section two",
          additions: [{ role: "user", content: [text("injected")] }],
        };
      },
    });

    const prepared = await registry.prepare({
      sessionId: sessionId("session"),
      cwd: process.cwd(),
      history: [],
      prompt: [text("prompt")],
      signal: new AbortController().signal,
    });

    expect(prepared.systemPrompt).toBe("base\n\nsection one\n\nsection two");
    expect(prepared.additions).toEqual([
      { role: "user", content: [text("injected")] },
      { role: "user", content: [text("prompt")] },
    ]);
    expect(prepared.messages).toEqual(prepared.additions);
  });
});
