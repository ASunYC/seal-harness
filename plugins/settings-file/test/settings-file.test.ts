import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { SettingsConflictError } from "@seal-harness/core";
import { FileSettingsService } from "../src/index.js";

describe("FileSettingsService", () => {
  it("materializes an absent provider-owned document before native opening", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.yaml");
    const service = await FileSettingsService.open(path); service.register("editor", { base: { fontSize: 14 } });
    expect(await service.prepareDocument()).toBe(path);
    expect(await readFile(path, "utf8")).toBe("{}\n");
    expect(await service.prepareDocument()).toBe(path);
  });

  it("layers values, atomically persists updates, publishes, and rejects stale writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json"); const emit = vi.fn(async () => {});
    const service = await FileSettingsService.open(path, emit); const scope = service.register("ui-theme", { base: { theme: "dark", size: 14 } }); const watch = vi.fn(); scope.watch(watch);
    expect(scope.get()).toMatchObject({ value: { theme: "dark", size: 14 }, revision: 0 });
    const changed = await scope.update({ size: 18 }, 0);
    expect(changed).toMatchObject({ value: { theme: "dark", size: 18 }, user: { size: 18 }, revision: 1 });
    await expect(scope.replace({ theme: "light" }, 0)).rejects.toBeInstanceOf(SettingsConflictError);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ "ui-theme": { size: 18 } });
    expect(emit).toHaveBeenCalledWith("settings.updated", expect.objectContaining({ namespace: "ui-theme", revision: 1 })); expect(watch).toHaveBeenCalledOnce();
  });

  it("loads stored namespaces before registration and validates the resolved layer", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, '{"runtime":{"mode":"fast"}}'));
    const service = await FileSettingsService.open(path); const scope = service.register("runtime", { base: { retries: 2 }, validate(value) { if (value.mode !== "fast") throw new Error("bad mode"); return value; } });
    expect(scope.get().value).toEqual({ retries: 2, mode: "fast" });
  });

  it("redacts declared secrets and hot-publishes valid external edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json");
    const service = await FileSettingsService.open(path); const scope = service.register("account", { base: { token: "secret", mode: "safe" }, secretPaths: [["token"]] });
    expect(service.describe({ redactSecrets: true })[0]).toMatchObject({ value: { mode: "safe" }, secrets: [{ path: ["token"], set: true }] });
    const changed = new Promise<void>((resolve) => scope.watch((next) => { if (next.value.mode === "fast") resolve(); }));
    const stop = service.startWatching(5); await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(path, '{"account":{"mode":"fast","token":"rotated"}}\n'); await changed;
    expect(scope.get()).toMatchObject({ revision: 1, value: { mode: "fast", token: "rotated" } });
    await stop();
  });

  it("redacts secrets nested through arrays", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json");
    const service = await FileSettingsService.open(path); service.register("accounts", { base: { rows: [{ name: "primary", token: "hidden" }] }, secretPaths: [["rows", "0", "token"]] });
    expect(service.describe({ redactSecrets: true })[0]).toMatchObject({ value: { rows: [{ name: "primary" }] }, secrets: [{ path: ["rows", "0", "token"], set: true }] });
  });

  it("resolves dynamic secret paths from the latest validated value", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const service = await FileSettingsService.open(join(root, "settings.json"));
    const scope = service.register("dynamic-secrets", { base: { accounts: [] }, secretPaths: (value) => (value.accounts as readonly unknown[]).map((_entry, index) => ["accounts", String(index), "token"]) });
    await scope.update({ accounts: [{ name: "one", token: "secret-one" }, { name: "two", token: "secret-two" }] });
    expect(service.describe({ redactSecrets: true })[0]).toMatchObject({ value: { accounts: [{ name: "one" }, { name: "two" }] }, secrets: [{ path: ["accounts", "0", "token"], set: true }, { path: ["accounts", "1", "token"], set: true }] });
  });

  it("rejects non-JSON nested values without changing durable state", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json"); const service = await FileSettingsService.open(path); const scope = service.register("safe");
    await expect(scope.update({ nested: { date: new Date() } } as any)).rejects.toThrow("JSON-compatible");
    await expect(scope.update({ list: [undefined] } as any)).rejects.toThrow("JSON-compatible");
    expect(scope.get()).toMatchObject({ revision: 0, value: {} });
  });

  it("serializes independent providers without dropping sibling namespaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json");
    const first = await FileSettingsService.open(path); const second = await FileSettingsService.open(path);
    const alpha = first.register("alpha"); const beta = second.register("beta");
    await Promise.all([alpha.update({ value: 1 }), beta.update({ value: 2 })]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ alpha: { value: 1 }, beta: { value: 2 } });
  });

  it("times out on a contended cross-process lock without touching the document", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json"); await writeFile(`${path}.lock`, "holder\n");
    const service = await FileSettingsService.open(path, async () => {}, 10); const scope = service.register("alpha");
    await expect(scope.update({ value: 1 })).rejects.toThrow("timed out waiting for the writer lock");
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("updates YAML with leaf-level edits while preserving sibling comments", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.yaml");
    await writeFile(path, "# account heading\naccount:\n  # mode choice\n  mode: safe\n  retries: 2\nother:\n  kept: true\n");
    const service = await FileSettingsService.open(path); const scope = service.register("account"); await scope.update({ mode: "fast" });
    const output = await readFile(path, "utf8"); expect(output).toContain("# account heading"); expect(output).toContain("# mode choice"); expect(output).toContain("mode: fast"); expect(output).toContain("retries: 2"); expect(output).toContain("other:");
  });

  it("applies ordered nested set and unset operations atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json");
    const service = await FileSettingsService.open(path); const scope = service.register("editor", { base: { inherited: true } });
    await scope.replace({ nested: { keep: "yes", remove: "old" }, rows: [{ name: "first" }] });
    const next = await scope.mutate([
      { op: "set", path: ["nested", "added"], value: 42 },
      { op: "unset", path: ["nested", "remove"] },
      { op: "set", path: ["rows", "0", "name"], value: "updated" },
    ], 1);
    expect(next).toMatchObject({ revision: 2, user: { nested: { keep: "yes", added: 42 }, rows: [{ name: "updated" }] }, value: { inherited: true } });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ editor: { nested: { keep: "yes", added: 42 }, rows: [{ name: "updated" }] } });
  });

  it("rejects malformed path operations without changing durable state", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const path = join(root, "settings.json");
    const service = await FileSettingsService.open(path); const scope = service.register("safe");
    await expect(scope.mutate([{ op: "set", path: ["value"], value: undefined } as any])).rejects.toThrow("JSON-compatible");
    await expect(scope.mutate([{ op: "unset", path: [1] } as any])).rejects.toThrow("path must contain only strings");
    expect(scope.get()).toMatchObject({ revision: 0, value: {} });
  });

  it("disposes namespace registrations and permits a clean replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-settings-")); const service = await FileSettingsService.open(join(root, "settings.json"));
    const first = service.register("dynamic", { base: { generation: 1 } }); const listener = vi.fn(); first.watch(listener); first.dispose(); first.dispose();
    expect(service.scope("dynamic")).toBeUndefined(); expect(service.describe()).toEqual([]);
    const second = service.register("dynamic", { base: { generation: 2 } }); await second.update({ enabled: true });
    expect(second.get().value).toEqual({ generation: 2, enabled: true }); expect(listener).not.toHaveBeenCalled();
  });
});
