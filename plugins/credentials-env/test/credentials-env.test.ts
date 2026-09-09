import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("persists writable references without exposing values through descriptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-credentials-")); const path = join(root, "credentials.json");
    try {
      const service = new EnvironmentCredentialService({ path, environment: {} }); await service.initialize();
      await service.setRef("DEEPSEEK_API_KEY", "secret-value");
      await expect(service.resolveRef("DEEPSEEK_API_KEY")).resolves.toBe("secret-value");
      await expect(service.resolve({ provider: "deepseek", name: "apiKey" })).resolves.toBe("secret-value");
      await expect(service.describeRef("DEEPSEEK_API_KEY")).resolves.toEqual({ configured: true, source: "file", writable: true });
      expect(await readFile(path, "utf8")).toContain("secret-value");
      const restored = new EnvironmentCredentialService({ path, environment: {} }); await restored.initialize();
      await expect(restored.resolveRef("DEEPSEEK_API_KEY")).resolves.toBe("secret-value");
      await restored.unsetRef("DEEPSEEK_API_KEY");
      await expect(restored.resolveRef("DEEPSEEK_API_KEY")).resolves.toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("refuses writes shadowed by an inherited environment value", async () => {
    const service = new EnvironmentCredentialService({ path: "unused.json", environment: { DEEPSEEK_API_KEY: "inherited" } });
    await expect(service.setRef("DEEPSEEK_API_KEY", "replacement")).rejects.toThrow("launching environment");
    await expect(service.describeRef("DEEPSEEK_API_KEY")).resolves.toEqual({ configured: true, source: "env", writable: false });
  });

  it("atomically persists api-key and opaque grant records", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-records-")); const path = join(root, "credentials.json");
    try {
      const service = new EnvironmentCredentialService({ path, environment: {} }); await service.initialize();
      await service.modifyRecord("provider/deepseek", async () => ({ kind: "api-key", key: "secret", env: { REGION: "cn" } }));
      await service.modifyRecord("oauth/account", async () => ({ kind: "grant", payload: { access: "token", expires: 10 } }));
      await expect(service.listRecords()).resolves.toEqual([
        { key: "oauth/account", kind: "grant" }, { key: "provider/deepseek", kind: "api-key" },
      ]);
      await expect(service.describeRecord("provider/deepseek")).resolves.toEqual({ configured: true, kind: "api-key", writable: true });
      const restored = new EnvironmentCredentialService({ path, environment: {} }); await restored.initialize();
      await expect(restored.readRecord("oauth/account")).resolves.toEqual({ kind: "grant", payload: { access: "token", expires: 10 } });
      const unchanged = await restored.modifyRecord("oauth/account", async (current) => { expect(current).toMatchObject({ kind: "grant" }); return undefined; });
      expect(unchanged).toMatchObject({ kind: "grant" });
      await restored.deleteRecord("oauth/account");
      await expect(restored.readRecord("oauth/account")).resolves.toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("preserves concurrent writes from independent provider instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-credential-lock-")); const path = join(root, "credentials.json");
    try {
      const first = new EnvironmentCredentialService({ path, environment: {} }); const second = new EnvironmentCredentialService({ path, environment: {} });
      await Promise.all([first.initialize(), second.initialize()]);
      await Promise.all([first.setRef("FIRST_KEY", "one"), second.modifyRecord("oauth/second", async () => ({ kind: "grant", payload: { value: 2 } }))]);
      const restored = new EnvironmentCredentialService({ path, environment: {} }); await restored.initialize();
      await expect(restored.resolveRef("FIRST_KEY")).resolves.toBe("one");
      await expect(restored.readRecord("oauth/second")).resolves.toEqual({ kind: "grant", payload: { value: 2 } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("hot reloads valid external edits and retains the last good state after invalid input", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-credential-watch-")); const path = join(root, "credentials.json");
    try {
      const service = new EnvironmentCredentialService({ path, environment: {}, debounceMs: 5 }); await service.initialize();
      const changes: any[] = []; service.subscribe((change) => changes.push(change)); const stop = service.startWatching();
      await new Promise((resolve) => setTimeout(resolve, 20)); await service.setRef("FIRST_KEY", "one");
      await writeFile(path, `${JSON.stringify({ version: 1, refs: { SECOND_KEY: "two" }, records: {} })}\n`);
      await eventually(async () => await service.resolveRef("SECOND_KEY") === "two");
      expect(changes).toEqual(expect.arrayContaining([{ kind: "reference", reference: "FIRST_KEY" }, { kind: "reference", reference: "SECOND_KEY" }]));
      await writeFile(path, "{ invalid"); await new Promise((resolve) => setTimeout(resolve, 30));
      await expect(service.resolveRef("SECOND_KEY")).resolves.toBe("two"); await stop();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let index = 0; index < 100; index += 1) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error("condition not reached");
}
