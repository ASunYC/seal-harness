import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const temporary = await mkdtemp(join(tmpdir(), "seal-desktop-gui-"));
await mkdir(join(root, ".artifacts"), { recursive: true });
const env = { ...process.env, SEAL_DESKTOP_NODE: process.execPath, SEAL_DESKTOP_SMOKE: "1",
  SEAL_DESKTOP_DATA_HOME: join(temporary, "data"), SEAL_DESKTOP_WORKSPACE: temporary,
  SEAL_DESKTOP_SMOKE_RESULT: join(temporary, "result.json"),
  SEAL_DESKTOP_SCREENSHOT: join(root, ".artifacts/desktop-smoke.png") };
delete env.ELECTRON_RUN_AS_NODE;
try {
  if (process.env.SEAL_DESKTOP_SMOKE_STREAM === "1" && process.env.SEAL_DESKTOP_BINARY) throw new Error("Stream fixture requires the source desktop build");
  if (process.env.SEAL_DESKTOP_SMOKE_STREAM === "1") await writeFile(join(temporary, "stream-check.txt"), "original fixture\n");
  if (process.env.SEAL_DESKTOP_SMOKE_HISTORY === "1") {
    const { seedHistory } = await import("./fixture-history.mjs");
    await seedHistory(temporary, env.SEAL_DESKTOP_DATA_HOME);
  }
  await new Promise((resolve, reject) => {
    const binary = process.env.SEAL_DESKTOP_BINARY;
    const child = spawn(binary || electron, [...(binary ? [] : [resolvePath()]), "--smoke-test"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Desktop smoke timed out")); }, binary ? 180_000 : 90_000);
    child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", chunk => process.stderr.write(chunk));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", async code => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(`Desktop smoke exited with code ${code}; see the preceding browser error`);
        const state = JSON.parse(await readFile(env.SEAL_DESKTOP_SMOKE_RESULT, "utf8"));
        if(process.env.SEAL_DESKTOP_SMOKE_STARTUP_CANCEL === '1') {
          if(await readFile(join(env.SEAL_DESKTOP_DATA_HOME,'startup-cancelled.txt'),'utf8')!=='aborted') throw new Error('Startup cancellation did not reach the backend compaction service');
        }
        if (process.env.SEAL_DESKTOP_SMOKE_TOOL_CANCEL === "1") {
          await new Promise(resolve => setTimeout(resolve, 4500));
          try { await readFile(join(temporary, "cancel-effect.txt")); throw new Error("Cancelled shell continued executing"); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (process.env.SEAL_DESKTOP_SMOKE_STREAM === "1" && await readFile(join(temporary, "stream-check.txt"), "utf8") !== "original fixture\n") throw new Error("PI review rollback did not restore the original file");
        if (code !== 0 || state.token !== false || state.node !== "undefined" || state.root !== true) throw new Error(`Desktop smoke failed (${code})`);
        if (!output.includes("SEAL_DESKTOP_SMOKE_OK")) process.stdout.write(`SEAL_DESKTOP_SMOKE_OK ${JSON.stringify(state)}\n`);
        resolve();
      } catch (error) { reject(error); }
    });
  });
} finally { await rm(temporary, { recursive: true, force: true }); }
function resolvePath() { return resolve(directory, ".."); }
