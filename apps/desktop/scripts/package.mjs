import { spawn } from "node:child_process";
import { cp, copyFile, mkdir, readFile, access, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const desktop = JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8"));
if (manifest.version !== desktop.version) throw new Error("Desktop/workspace version mismatch");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Use pnpm desktop:dist");
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pnpm, ...args], { cwd: root, stdio: "inherit", windowsHide: true });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Packaging command failed (${code})`)));
  });
}
await run(["pack:smoke"]);
await run(["release:bundle", "--version", manifest.version]);
const platform = { win32: "windows", linux: "linux", darwin: "macos" }[process.platform];
const bundle = join(root, ".artifacts/release", `seal-harness-${manifest.version}-${platform}-${process.arch}`);
const stage = join(root, ".artifacts/desktop-runtime");
// Replace only a fixed, generated staging directory through a fresh bundle copy.
// Do not include bundle-local smoke-test sessions or credentials in the desktop.
if (resolve(stage) !== resolve(root, ".artifacts", "desktop-runtime")) throw new Error("Invalid desktop staging path");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const name of ["app", "runtime"]) await cp(join(bundle, name), join(stage, name), { recursive: true, force: true });
await copyFile(join(root, "apps/desktop/src/backend.mjs"), join(stage, "app/backend.mjs"));
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "NODE_LICENSE"]) await copyFile(join(bundle, name), join(stage, name));
await access(join(stage, "app/node_modules/@seal-harness/web/dist/index.js"));
await run(["--filter", "@seal-harness/desktop", "dist", ...(process.platform === "win32" ? ["--win"] : ["--linux"])]);
