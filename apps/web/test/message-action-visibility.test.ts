import { describe, expect, it } from "vitest";

describe("message action visibility", () => {
  it("keeps only the latest message of each role always visible", async () => {
    const { messageActionRevealModes } = await import(new URL("../public/message-action-visibility.js", import.meta.url).href);
    expect(messageActionRevealModes(["user", "assistant", "user", "assistant"]))
      .toEqual(["hover", "hover", "always", "always"]);
  });

  it("ignores non-message roles without changing their stable hover fallback", async () => {
    const { messageActionRevealModes } = await import(new URL("../public/message-action-visibility.js", import.meta.url).href);
    expect(messageActionRevealModes(["tool", "user", "context"]))
      .toEqual(["hover", "always", "hover"]);
  });
});
