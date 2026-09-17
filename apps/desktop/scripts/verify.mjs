import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, verifyPublicAssets } from "./artifact-check.mjs";
import { packageTargets } from "./package-targets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packaged = process.argv.includes("--packaged");
if (process.argv.slice(2).some(arg => arg !== "--packaged")) throw new Error("Usage: verify.mjs [--packaged]");
const { version } = JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8"));
const layout = packaged ? packageTargets(root, version, process.platform, process.arch) : undefined;
const cases = packaged ? [
  ...layout.targets.flatMap(([kind, options]) => {
    return [
      [`${kind}-tools`, { ...options, SEAL_DESKTOP_SMOKE_TOOLS: "1" }],
      [`${kind}-child`, { ...options, SEAL_DESKTOP_SMOKE_CHILD: "1" }],
      [`${kind}-history`, { ...options, SEAL_DESKTOP_SMOKE_HISTORY: "1" }],
    ];
  }),
] : [
  ["stream-light", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_THEME: "light" }],
  ["stream-dark", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_THEME: "dark" }],
  ["cancel", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_CANCEL: "1" }],
  ["startup-cancel", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_STARTUP_CANCEL: "1" }],
  ["queue", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_QUEUE: "1" }],
  ["queue-image", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_QUEUE: "1", SEAL_DESKTOP_SMOKE_QUEUE_IMAGE: "1" }],
  ["queue-image-remove", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_QUEUE: "1", SEAL_DESKTOP_SMOKE_QUEUE_IMAGE: "1", SEAL_DESKTOP_SMOKE_QUEUE_REMOVE: "1" }],
  ["queue-remove", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_QUEUE: "1", SEAL_DESKTOP_SMOKE_QUEUE_REMOVE: "1" }],
  ["steering", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_QUEUE: "1", SEAL_DESKTOP_SMOKE_STEER: "1" }],
  ["steering-remove", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_QUEUE: "1", SEAL_DESKTOP_SMOKE_STEER: "1", SEAL_DESKTOP_SMOKE_QUEUE_REMOVE: "1" }],
  ["failure-recovery", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_FAILURE: "1" }],
  ["tool-progress", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_TOOL_PROGRESS: "1" }],
  ["tool-cancel", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_TOOL_CANCEL: "1" }],
  ["history", { SEAL_DESKTOP_SMOKE_HISTORY: "1" }],
  ["child", { SEAL_DESKTOP_SMOKE_CHILD: "1" }],
  ["multi-child", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_MULTI: "1" }],
  ["multi-child-live", { SEAL_DESKTOP_SMOKE_STREAM: "1", SEAL_DESKTOP_SMOKE_MULTI: "1", SEAL_DESKTOP_SMOKE_MULTI_LIVE: "1" }],
  ["tools", { SEAL_DESKTOP_SMOKE_TOOLS: "1" }],
];
const reportDir = join(root, ".artifacts/desktop-verification", packaged ? "packaged" : "source");
await mkdir(reportDir, { recursive: true });
const report = { version, platform: process.platform, startedAt: new Date().toISOString(), completed: false, cases: [] };
const save = () => writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await save();
if (packaged) {
  const packedPublic = join(layout.resources, "backend/app/node_modules/@seal-harness/web/dist/public");
  try {
    report.assets = await verifyPublicAssets(join(root, "apps/web/public"), packedPublic);
    report.backend = {};
    const bundledPackages = join(layout.resources, "backend/app/node_modules/@seal-harness");
    for (const [name, location] of [["core", "packages/core"], ["web", "apps/web"], ["runtime-pi", "plugins/runtime-pi"], ["agent-core", "plugins/agent-core"], ["subagent-tools", "plugins/subagent-tools"], ["dsh-compat", "plugins/dsh-compat"]]) {
      report.backend[name] = await verifyPublicAssets(join(root, location, "dist"), join(bundledPackages, name, "dist"), name);
    }
    report.binaries = {};
    for (const binary of new Set(cases.map(([, options]) => options.SEAL_DESKTOP_BINARY))) {
      report.binaries[binary] = await fingerprint(binary);
    }
    await save();
  } catch (error) { report.error = String(error); await save(); throw error; }
}
for (const [name, options] of cases) {
  const env = { ...process.env };
  // No leaked flags from a previous manual smoke or another suite case.
  for (const key of Object.keys(env)) if (key.startsWith("SEAL_DESKTOP_") || key === "ELECTRON_RUN_AS_NODE") delete env[key];
  Object.assign(env, options);
  const result = { name, passed: false, startedAt: new Date().toISOString() };
  report.cases.push(result);
  process.stdout.write(`Desktop verification: ${name}\n`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "apps/desktop/scripts/smoke.mjs")], { cwd: root, env, stdio: "inherit", windowsHide: true });
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${name} failed (${code ?? signal})`)));
    });
    await copyFile(join(root, ".artifacts/desktop-smoke.png"), join(reportDir, `${name}.png`));
    result.passed = true;
  } catch (error) {
    result.error = String(error); await save(); throw error;
  }
  await save();
}
if (packaged) {
  for (const [binary, initial] of Object.entries(report.binaries)) {
    const current = await fingerprint(binary);
    if (current.sha256 !== initial.sha256 || current.bytes !== initial.bytes) {
      report.error = `Binary changed during verification: ${binary}`;
      await save(); throw new Error(report.error);
    }
  }
}
report.completed = true;
await save();
