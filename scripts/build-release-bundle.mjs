import { spawn } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = normalizeVersion(argument("--version") ?? process.env.RELEASE_VERSION ?? "0.3.1");
const platform = releasePlatform(process.platform);
const architecture = process.arch;
const bundleName = `seal-harness-${version}-${platform}-${architecture}`;
const releaseRoot = join(repositoryRoot, ".artifacts", "release");
const bundleRoot = join(releaseRoot, bundleName);
const appRoot = join(bundleRoot, "app");
const runtimeRoot = join(bundleRoot, "runtime");
const packRoot = join(repositoryRoot, ".artifacts", "packs");

await rm(bundleRoot, { recursive: true, force: true });
await mkdir(appRoot, { recursive: true });
await mkdir(runtimeRoot, { recursive: true });

const packages = await workspacePackages(repositoryRoot);
const tarballs = new Set(await readdir(packRoot));
const packed = Object.fromEntries(packages.map(({ manifest }) => {
  const filename = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
  if (!tarballs.has(filename)) throw new Error(`Missing release pack: ${filename}`);
  return [manifest.name, `file:${join(packRoot, filename)}`];
}));
if (packed["@seal-harness/launcher"] === undefined) throw new Error("Launcher pack is missing");

await writeFile(join(appRoot, "package.json"), JSON.stringify({
  name: "seal-harness-release-runtime",
  private: true,
  version,
  type: "module",
  dependencies: { "@seal-harness/launcher": packed["@seal-harness/launcher"] },
}, null, 2));
await writeFile(join(appRoot, "pnpm-workspace.yaml"), [
  "packages:",
  "  - .",
  "nodeLinker: hoisted",
  "packageImportMethod: copy",
  "overrides:",
  ...Object.entries(packed).map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`),
  "",
].join("\n"));

await runPnpm([
  "install", "--prod", "--ignore-scripts", "--frozen-lockfile=false",
  "--config.node-linker=hoisted", "--config.package-import-method=copy",
], appRoot);

const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimePath = join(runtimeRoot, runtimeName);
await copyFile(process.execPath, runtimePath);
if (process.platform !== "win32") await chmod(runtimePath, 0o755);

const launcherRelative = join("app", "node_modules", "@seal-harness", "launcher", "dist", "bin.js");
if (process.platform === "win32") {
  await writeFile(join(bundleRoot, "seal-harness.cmd"), [
    "@echo off",
    `\"%~dp0runtime\\node.exe\" \"%~dp0${launcherRelative.replaceAll("/", "\\")}\" %*`,
    "",
  ].join("\r\n"));
  await writeFile(join(bundleRoot, "Start Seal Harness.cmd"), [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "title Seal Harness",
    "echo Starting Seal Harness Web UI...",
    "echo Close this window or press Ctrl+C to stop.",
    "echo.",
    "if defined SEAL_HARNESS_START_ARGS (",
    "  call \"%~dp0seal-harness.cmd\" %SEAL_HARNESS_START_ARGS%",
    ") else (",
    "  call \"%~dp0seal-harness.cmd\" web",
    ")",
    "set \"SEAL_HARNESS_EXIT_CODE=%ERRORLEVEL%\"",
    "if not \"%SEAL_HARNESS_EXIT_CODE%\"==\"0\" (",
    "  echo.",
    "  echo Seal Harness exited with code %SEAL_HARNESS_EXIT_CODE%.",
    "  if not defined SEAL_HARNESS_START_ARGS pause",
    ")",
    "exit /b %SEAL_HARNESS_EXIT_CODE%",
    "",
  ].join("\r\n"));
} else {
  const script = [
    "#!/usr/bin/env sh",
    "set -eu",
    "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    `exec \"$SCRIPT_DIR/runtime/node\" \"$SCRIPT_DIR/${launcherRelative}\" \"$@\"`,
    "",
  ].join("\n");
  const launcherPath = join(bundleRoot, "seal-harness");
  await writeFile(launcherPath, script);
  await chmod(launcherPath, 0o755);
}

await copyFile(join(repositoryRoot, "LICENSE"), join(bundleRoot, "LICENSE"));
await copyFile(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), join(bundleRoot, "THIRD_PARTY_NOTICES.md"));
await copyFile(join(repositoryRoot, "README.md"), join(bundleRoot, "README.md"));
await cp(join(repositoryRoot, "assets"), join(bundleRoot, "assets"), { recursive: true });
await writeNodeLicense(join(bundleRoot, "NODE_LICENSE"));
await writeFile(join(bundleRoot, "VERSION"), `${version}\n`);
await writeFile(join(bundleRoot, "QUICKSTART.txt"), quickstart(platform, version));

await smokeBundle(bundleRoot, runtimePath, join(bundleRoot, launcherRelative));
process.stdout.write(`Built and verified ${bundleRoot}\n`);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function normalizeVersion(value) {
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return normalized;
}

function releasePlatform(value) {
  if (value === "win32") return "windows";
  if (value === "darwin") return "macos";
  if (value === "linux") return "linux";
  throw new Error(`Unsupported release platform: ${value}`);
}

async function workspacePackages(root) {
  const values = [];
  for (const group of ["packages", "plugins", "apps"]) {
    for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(await readFile(join(root, group, entry.name, "package.json"), "utf8"));
      if (manifest.private !== true) values.push({ manifest });
    }
  }
  return values;
}

async function writeNodeLicense(path) {
  const url = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Node.js license (${response.status}): ${url}`);
  await writeFile(path, await response.text());
}

async function smokeBundle(root, runtime, launcher) {
  const help = await run(runtime, [launcher, "help"], root, true);
  if (!help.stdout.includes("seal-harness web")) throw new Error(`Release launcher failed:\n${help.stdout}`);

  const child = spawn(runtime, [launcher, "web", "--port", "0", "--no-open"], {
    cwd: root,
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
    const timeout = setTimeout(() => reject(new Error(`Release Web UI did not start:\n${stderr}`)), 20_000);
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
      reject(new Error(`Release Web UI exited before startup (${code}):\n${stderr}`));
    });
  });
  try {
    const response = await fetch(url);
    if (!response.ok || !(await response.text()).includes("Seal Harness")) {
      throw new Error(`Release Web UI smoke failed: ${response.status}`);
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

function quickstart(platform, releaseVersion) {
  const command = platform === "windows" ? "seal-harness.cmd web" : "./seal-harness web";
  return [
    `Seal Harness ${releaseVersion}`,
    "",
    ...(platform === "windows"
      ? [
          "1. Double-click Start Seal Harness.cmd.",
          "2. Keep the console window open while using Seal Harness; close it to stop.",
          `3. Terminal alternative: ${command}`,
          "4. Open http://127.0.0.1:3080 if the browser does not open automatically.",
          "5. Expand Connection, choose a workspace and model, then set the API key.",
        ]
      : [
          "1. Open a terminal in this extracted directory.",
          `2. Run: ${command}`,
          "3. Open http://127.0.0.1:3080 if the browser does not open automatically.",
          "4. Expand Connection, choose a workspace and model, then set the API key.",
        ]),
    "",
    "Headless example:",
    platform === "windows"
      ? "  seal-harness.cmd run --provider deepseek \"Inspect this repository\""
      : "  ./seal-harness run --provider deepseek \"Inspect this repository\"",
    "",
    "Security: the Web UI listens on 127.0.0.1 by default. Do not expose it publicly.",
    "Documentation: README.md",
    "",
  ].join("\n");
}

function runPnpm(args, cwd) {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (pnpmEntrypoint === undefined) {
    throw new Error("Release bundle must be launched through pnpm release:bundle");
  }
  return run(process.execPath, [pnpmEntrypoint, ...args], cwd);
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
    child.once("close", (code) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr}`)));
  });
}
