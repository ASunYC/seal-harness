import { describe, expect, it } from "vitest";
import { EnvironmentCredentialService } from "../src/index.js";

describe("EnvironmentCredentialService", () => {
  it("uses explicit mappings without exposing unrelated variables", async () => {
    const service = new EnvironmentCredentialService({
      variables: { "deepseek.apiKey": "SECRET_DEEPSEEK" },
      environment: { SECRET_DEEPSEEK: "secret-value", OTHER: "not-visible" },
    });

    await expect(service.resolve({ provider: "deepseek", name: "apiKey" }))
      .resolves.toBe("secret-value");
    await expect(service.resolve({ provider: "other", name: "apiKey" }))
      .resolves.toBeUndefined();
  });

  it("derives a conventional environment variable name", async () => {
    const service = new EnvironmentCredentialService({
      environment: { OPENROUTER_API_KEY: "key" },
    });
    await expect(service.resolve({ provider: "openrouter", name: "apiKey" }))
      .resolves.toBe("key");
  });
});
