import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = join(repositoryRoot, ".artifacts", "packs");
const installRoot = await mkdtemp(join(tmpdir(), "seal-harness-pack-smoke-"));
const pnpmEntrypoint = process.env.npm_execpath;
if (pnpmEntrypoint === undefined) {
  throw new Error("pack:smoke must be launched through pnpm");
}

try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await runPnpm(["build"], repositoryRoot);
  const storePath = (await runPnpm(["store", "path"], repositoryRoot, true)).stdout.trim();

  const packages = await workspacePackages(repositoryRoot);
  validateManifests(packages);
  for (const entry of packages) {
    await runPnpm(["--filter", entry.manifest.name, "pack", "--pack-destination", artifactRoot], repositoryRoot);
  }

  const tarballs = await readdir(artifactRoot);
  if (tarballs.length !== packages.length) {
    throw new Error(`Expected ${packages.length} tarballs, found ${tarballs.length}`);
  }
  for (const tarball of tarballs) {
    const listing = (await run("tar", ["-tf", join(artifactRoot, tarball)], repositoryRoot, true)).stdout;
    const forbidden = listing.split(/\r?\n/).filter((entry) =>
      /(^|\/)(src|test|tests|coverage|sessions|\.seal-harness)(\/|$)/.test(entry)
      || /(^|\/)\.env(?:\.|$)/.test(entry),
    );
    if (forbidden.length > 0) {
      throw new Error(`${tarball} contains forbidden files:\n${forbidden.join("\n")}`);
    }
  }
  const dependencies = Object.fromEntries(packages.map((entry) => {
    const expected = `${entry.manifest.name.replace(/^@/, "").replace("/", "-")}-${entry.manifest.version}.tgz`;
    if (!tarballs.includes(expected)) throw new Error(`Missing packed artifact: ${expected}`);
    return [entry.manifest.name, `file:${join(artifactRoot, expected)}`];
  }));
  await writeFile(join(installRoot, "package.json"), JSON.stringify({
    name: "seal-harness-packed-smoke",
    private: true,
    type: "module",
    dependencies,
  }, null, 2));
  await writeFile(
    join(installRoot, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - .",
      "overrides:",
      ...Object.entries(dependencies).map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`),
      "",
    ].join("\n"),
  );
  await writeFile(join(installRoot, "seal-harness.config.mjs"), `
import { agentCorePlugin } from "@seal-harness/agent-core";
import { contextCorePlugin } from "@seal-harness/context-core";
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";
import { scriptedModelPlugin } from "@seal-harness/model-scripted";
import { piRuntimePlugin } from "@seal-harness/runtime-pi";
import { memorySessionPlugin } from "@seal-harness/session-memory";

export default defineProfile([
  plugin(scriptedModelPlugin, {
    models: [{ provider: "scripted", model: "packed", contextWindow: 1000, maxOutputTokens: 100 }],
    async *respond() {
      yield { type: "text_delta", delta: "packed-install-ok" };
      yield { type: "done", stopReason: "stop" };
    },
  }),
  plugin(memorySessionPlugin, {}),
  plugin(contextCorePlugin, { systemPrompt: "packed smoke" }),
  plugin(piRuntimePlugin, {}),
  plugin(agentCorePlugin, {}),
]);
`);

  await runPnpm([
    "install",
    "--prefer-offline",
    "--ignore-scripts",
    "--store-dir",
    storePath,
  ], installRoot);
  await writeFile(join(installRoot, "dsh-compat-smoke.mjs"), `
import { DshCompatRuntime } from "@seal-harness/dsh-compat";

const events = [];
const runtime = new DshCompatRuntime(undefined, {
  services: { greeting: { value: "packed" } },
  plugins: [{
    plugin: {
      name: "packed-dsh-plugin",
      inject: ["greeting"],
      apply(ctx) {
        events.push(ctx.get("greeting").value);
        ctx.effect(() => () => events.push("disposed"));
      },
    },
  }],
});
await runtime.start();
if (events.join(",") !== "packed") throw new Error("packed DSH plugin did not start");
  await runtime.stop();
if (events.join(",") !== "packed,disposed") throw new Error("packed DSH plugin did not dispose");
`);
  await run(process.execPath, [join(installRoot, "dsh-compat-smoke.mjs")], installRoot, true);
  const pluginFixture = join(installRoot, "plugin-fixture");
  await mkdir(join(pluginFixture, "lib"), { recursive: true });
  await writeFile(join(pluginFixture, "package.json"), JSON.stringify({
    name: "@seal-harness-test/packed-plugin",
    version: "1.0.0",
    type: "module",
    main: "lib/index.js",
    exports: { ".": "./lib/index.js", "./package.json": "./package.json" },
  }, null, 2));
  await writeFile(join(pluginFixture, "lib", "index.js"), "export function apply() {}\n");
  const pluginHome = join(installRoot, "plugin-home");
  const packedLauncher = join(installRoot, "node_modules", "@seal-harness", "launcher", "dist", "bin.js");
  await run(process.execPath, [packedLauncher, "plugin", "--home", pluginHome, "add", pluginFixture], installRoot, true);
  const pluginList = await run(process.execPath, [packedLauncher, "plugin", "--home", pluginHome, "list"], installRoot, true);
  if (!pluginList.stdout.includes("@seal-harness-test/packed-plugin@1.0.0")) {
    throw new Error(`Packed plugin add/list smoke failed: ${pluginList.stdout}`);
  }
  await run(process.execPath, [packedLauncher, "plugin", "--home", pluginHome, "remove", "@seal-harness-test/packed-plugin"], installRoot, true);
  const removedList = await run(process.execPath, [packedLauncher, "plugin", "--home", pluginHome, "list"], installRoot, true);
  if (removedList.stdout.trim().length !== 0) {
    throw new Error(`Packed plugin remove smoke failed: ${removedList.stdout}`);
  }
  const result = await run(
    process.execPath,
    [
      join(installRoot, "node_modules", "@seal-harness", "cli", "dist", "bin.js"),
      "--config",
      join(installRoot, "seal-harness.config.mjs"),
      "--provider",
      "scripted",
      "--model",
      "packed",
      "smoke",
    ],
    installRoot,
    true,
  );
  if (!result.stdout.includes("packed-install-ok")) {
    throw new Error(`Packed CLI smoke output was unexpected: ${result.stdout}`);
  }
  const launcherResult = await run(
    process.execPath,
    [join(installRoot, "node_modules", "@seal-harness", "launcher", "dist", "bin.js"), "help"],
    installRoot,
    true,
  );
  if (!launcherResult.stdout.includes("seal-harness web")) {
    throw new Error(`Packed launcher smoke output was unexpected: ${launcherResult.stdout}`);
  }
  await smokeWeb(
    join(installRoot, "node_modules", "@seal-harness", "web", "dist", "bin.js"),
    installRoot,
  );
  process.stdout.write(
    `Packed ${packages.length} packages and verified CLI, launcher, Web UI, plugin add/remove, DSH compatibility, and a clean install.\n`,
  );
} finally {
  await rm(installRoot, { recursive: true, force: true });
}

async function workspacePackages(root) {
  const directories = [];
  for (const group of ["packages", "plugins", "apps"]) {
    for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(root, group, entry.name));
    }
  }
  const packages = [];
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (manifest.private !== true) packages.push({ directory, manifest });
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function validateManifests(packages) {
  const names = new Set(packages.map((entry) => entry.manifest.name));
  const versions = new Set(packages.map((entry) => entry.manifest.version));
  if (versions.size !== 1) {
    throw new Error(`Publishable packages do not share one version: ${[...versions].join(", ")}`);
  }
  for (const entry of packages) {
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, range] of Object.entries(entry.manifest[section] ?? {})) {
        if (names.has(name)) {
          if (!String(range).startsWith("workspace:")) {
            throw new Error(`${entry.manifest.name} must use workspace protocol for ${name}`);
          }
        } else if (/^[~^]/.test(String(range))) {
          throw new Error(`${entry.manifest.name} must pin direct dependency ${name}: ${range}`);
        }
      }
    }
  }
}

function run(command, args, cwd, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`));
    });
  });
}

function runPnpm(args, cwd, capture = false) {
  return run(process.execPath, [pnpmEntrypoint, ...args], cwd, capture);
}

async function smokeWeb(bin, cwd) {
  const child = spawn(process.execPath, [bin, "--port", "0", "--no-open"], {
    cwd,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const url = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Packed Web UI did not start:\n${stderr}`)), 15_000);
    const inspect = () => {
      const match = /Seal Harness Web UI: (http:\/\/[^\s]+)/.exec(stdout);
      if (match?.[1] === undefined) return;
      clearTimeout(timeout);
      resolvePromise(match[1]);
    };
    child.stdout.on("data", inspect);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Packed Web UI exited before startup (${code}):\n${stderr}`));
    });
  });
  try {
    const [index, health] = await Promise.all([
      fetch(url),
      fetch(`${url}/api/health`),
    ]);
    const indexText = await index.text();
    if (
      !index.ok
      || !indexText.includes("Seal Harness")
      || !indexText.includes('data-pane="conversation"')
      || !indexText.includes("/client-runtime.js")
    ) {
      throw new Error(`Packed Web UI index smoke failed: ${index.status}`);
    }
    if (!health.ok || (await health.json()).status !== "ok") {
      throw new Error(`Packed Web UI health smoke failed: ${health.status}`);
    }
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => child.once("close", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
