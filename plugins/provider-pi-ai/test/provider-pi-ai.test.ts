import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { PiAiModelService } from "../src/index.js";

describe("PiAiModelService", () => {
  it("exposes only providers registered in its Pi Models collection", async () => {
    const models = createModels();
    models.setProvider(deepseekProvider());
    const service = new PiAiModelService(models);

    const listed = await service.list();
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed.map((model) => model.provider))).toEqual(new Set(["deepseek"]));
    const first = listed[0];
    expect(first).toBeDefined();
    await expect(service.get({ provider: "deepseek", model: first?.model ?? "" }))
      .resolves.toEqual(first);
    await expect(service.get({ provider: "openai", model: "missing" }))
      .resolves.toBeUndefined();
  });
});
