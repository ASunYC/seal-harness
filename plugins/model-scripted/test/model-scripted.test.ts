import { describe, expect, it } from "vitest";
import { ScriptedModelService } from "../src/index.js";

describe("ScriptedModelService", () => {
  it("lists and resolves only configured models", async () => {
    const model = {
      provider: "scripted",
      model: "test",
      contextWindow: 100,
      maxOutputTokens: 10,
    };
    const service = new ScriptedModelService({
      models: [model],
      async *respond() { yield { type: "done", stopReason: "stop" }; },
    });
    await expect(service.list()).resolves.toEqual([model]);
    await expect(service.get({ provider: "scripted", model: "test" })).resolves.toEqual(model);
    await expect(service.get({ provider: "other", model: "test" })).resolves.toBeUndefined();
  });
});
