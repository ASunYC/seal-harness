import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, type Provider, type OAuthCredential, type ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { EnvironmentCredentialService } from "../../credentials-env/src/index.js";
import { piCredentialStore } from "../src/credentials.js";
import { PiLoginFlows } from "../src/login.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
it("persists OAuth, refreshes through PI and removes only the selected provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seal-pi-auth-")); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const service = new EnvironmentCredentialService({ path: join(dir, "credentials.json") }); await service.initialize();
  const store = piCredentialStore(service);
  await store.modify("fixture", async () => ({ type: "oauth", access: "old", refresh: "refresh", expires: 0 }));
  await store.modify("other", async () => ({ type: "api_key", key: "keep" }));
  const reopened = new EnvironmentCredentialService({ path: join(dir, "credentials.json") }); await reopened.initialize();
  const models = createModels({ credentials: piCredentialStore(reopened) });
  models.setProvider({ id: "fixture", name: "Fixture", getModels: () => [], auth: { oauth: {
    name: "Fixture", login: async () => { throw new Error("not used"); },
    refresh: async (credential: OAuthCredential) => ({ ...credential, access: "new", expires: Date.now() + 3_600_000 }),
    toAuth: async (credential: OAuthCredential) => ({ apiKey: credential.access }),
  } } } as unknown as Provider);
  expect((await models.getAuth("fixture"))?.auth.apiKey).toBe("new");
  expect((await piCredentialStore(reopened).read("fixture"))?.type).toBe("oauth");
  await models.logout("fixture");
  expect(await piCredentialStore(reopened).read("fixture")).toBeUndefined();
  expect(await piCredentialStore(reopened).read("other")).toEqual({ type: "api_key", key: "keep" });
});
it("rejects persistence after cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(piCredentialStore({ resolve: async () => undefined }).modify("fixture", async () => undefined, { signal: controller.signal })).rejects.toThrow();
});
it("bridges prompts without exposing credential results", async () => {
  const models = createModels();
  models.setProvider({ id: "fixture", name: "Fixture", getModels: () => [], auth: { oauth: {
    name: "Fixture",
    login: async (interaction: ProviderAuthInteraction) => {
      const answer = await interaction.prompt({ type: "manual_code", message: "Code" });
      return { type: "oauth", access: answer, refresh: "secret-refresh", expires: Date.now() + 3_600_000 };
    },
    refresh: async (credential: OAuthCredential) => credential, toAuth: async (credential: OAuthCredential) => ({ apiKey: credential.access }),
  } } } as unknown as Provider);
  const flows = new PiLoginFlows(() => models); cleanup.push(async () => flows.close());
  const id = flows.start("fixture", "oauth");
  await expect.poll(() => flows.read(id).prompt?.id).toBeTruthy();
  flows.answer(id, flows.read(id).prompt!.id, "secret-code");
  await expect.poll(() => flows.read(id).state).toBe("complete");
  expect(JSON.stringify(flows.read(id))).not.toContain("secret");
  flows.cancel(id); expect(() => flows.read(id)).toThrow();
});
