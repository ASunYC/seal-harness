import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginProfileManager, type PackageManagerRunner } from "../src/index.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PluginProfileManager", () => {
  it("adds, inspects, disables, enables and removes a DSH package", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-plugin-manager-"));
    temporary.push(root);
    const fixture = join(root, "fixture");
    await writeFixture(fixture);
    const runner = fixtureRunner(fixture);
    const manager = new PluginProfileManager({ home: join(root, "home"), profile: "web", runPackageManager: runner });

    const added = await manager.add(fixture);
    expect(added).toEqual([expect.objectContaining({
      name: "@fixture/dsh-skin",
      version: "1.2.3",
      enabled: true,
      clientInject: [],
      wiringId: "ui-fixture-skin",
      skin: expect.objectContaining({ id: "fixture", bodyAttr: "data-dsh-fixture" }),
    })]);
    expect(await manager.doctor()).toEqual([expect.objectContaining({ status: "ready" })]);
    expect((await manager.loadHostPlugins()).length).toBe(1);

    await manager.setEnabled("@fixture/dsh-skin", false);
    expect(await manager.list()).toEqual([expect.objectContaining({ enabled: false })]);
    await manager.setEnabled("@fixture/dsh-skin", true);
    expect(await manager.list()).toEqual([expect.objectContaining({ enabled: true })]);

    await expect(manager.remove(["missing"])).rejects.toThrow("not installed");
    await manager.remove(["@fixture/dsh-skin"]);
    expect(await manager.list()).toEqual([]);
  });

  it("reports unsupported inject services without failing installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "seal-plugin-doctor-"));
    temporary.push(root);
    const fixture = join(root, "fixture");
    await writeFixture(fixture, ["unknown-host"], ["slots"]);
    const manager = new PluginProfileManager({
      home: join(root, "home"),
      runPackageManager: fixtureRunner(fixture),
    });
    await manager.add(fixture);
    expect(await manager.doctor()).toEqual([expect.objectContaining({
      status: "adapter-required",
      missingHostServices: ["unknown-host"],
      missingClientServices: ["slots"],
    })]);
  });
});

function fixtureRunner(fixture: string): PackageManagerRunner {
  return async (args, options) => {
    const manifestPath = join(options.cwd, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { dependencies: Record<string, string> };
    if (args[0] === "add") {
      const packageManifest = JSON.parse(await readFile(join(fixture, "package.json"), "utf8")) as { name: string };
      manifest.dependencies[packageManifest.name] = fixture;
      const target = join(options.cwd, "node_modules", ...packageManifest.name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await cp(fixture, target, { recursive: true });
    } else if (args[0] === "remove") {
      for (const name of args.slice(1)) {
        delete manifest.dependencies[name];
        await rm(join(options.cwd, "node_modules", ...name.split("/")), { recursive: true, force: true });
      }
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  };
}

async function writeFixture(
  root: string,
  hostInject: readonly string[] = [],
  clientInject: readonly string[] = [],
): Promise<void> {
  await mkdir(join(root, "lib"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@fixture/dsh-skin",
    version: "1.2.3",
    type: "module",
    main: "lib/index.js",
    exports: { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
    dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { inject: clientInject, platform: "web" } },
  }, null, 2));
  await writeFile(
    join(root, "lib", "index.js"),
    `export const inject = ${JSON.stringify(hostInject)}; export function apply() {}`,
  );
  await writeFile(join(root, "lib", "client.js"), "window.__ModuleLoader__.load({id:'@fixture/dsh-skin',factory:()=>({apply(){}})});\n");
  await writeFile(join(root, "cordis.patch.yml"), "- insert:\n    - id: ui-fixture-skin\n      name: '@fixture/dsh-skin'\n");
  await writeFile(join(root, "skin.json"), JSON.stringify({
    id: "fixture",
    name: "Fixture",
    package: "@fixture/dsh-skin",
    bodyAttr: "data-dsh-fixture",
    order: 1,
  }));
}
