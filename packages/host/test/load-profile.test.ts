import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProfile, ProfileNotFoundError } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("loadProfile", () => {
  it("discovers and loads a native ESM profile", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(
      join(cwd, "seal-harness.config.mjs"),
      `export default [{ plugin: { name: "example", setup() {} }, config: { value: 1 } }];\n`,
    );

    const loaded = await loadProfile({ cwd });
    expect(loaded.configPath).toBe(await realpath(join(cwd, "seal-harness.config.mjs")));
    expect(loaded.profile).toHaveLength(1);
    expect(loaded.profile[0]?.plugin.name).toBe("example");
  });

  it("loads an explicit relative path", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "custom.mjs"), "export default [];\n");

    const loaded = await loadProfile({ cwd, configPath: "custom.mjs" });
    expect(loaded.configPath).toBe(await realpath(join(cwd, "custom.mjs")));
    expect(loaded.profile).toEqual([]);
  });

  it("fails clearly when no profile exists", async () => {
    const cwd = await temporaryDirectory();
    await expect(loadProfile({ cwd })).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("rejects a malformed profile", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "seal-harness.config.mjs"), "export default { plugins: [] };\n");

    await expect(loadProfile({ cwd })).rejects.toMatchObject({
      name: "InvalidProfileError",
    });
  });

  it("rejects duplicate enabled instance ids before startup", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(
      join(cwd, "seal-harness.config.mjs"),
      `const plugin = { name: "same", setup() {} };\nexport default [\n  { plugin, config: undefined },\n  { plugin, config: undefined },\n];\n`,
    );

    await expect(loadProfile({ cwd })).rejects.toMatchObject({
      name: "InvalidProfileError",
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "seal-harness-host-"));
  temporaryDirectories.push(path);
  return path;
}
