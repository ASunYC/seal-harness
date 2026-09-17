import { mkdir } from "node:fs/promises";
import { startWebServer } from "@seal-harness/web";

// Run using stock Node, not Electron's Node ABI (PTY/native dependencies).
if (!process.send) throw new Error("Desktop backend requires a parent IPC channel");
const dataHome = process.env.SEAL_DESKTOP_DATA_HOME;
const cwd = process.env.SEAL_DESKTOP_WORKSPACE;
if (!dataHome || !cwd) throw new Error("Missing desktop data/workspace paths");
await mkdir(dataHome, { recursive: true });
let running;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await running?.close();
  process.exit(0);
}
process.on("message", message => { if (message?.type === "shutdown") void stop(); });
process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  let profile;
  // Only the development smoke launcher supplies this flag. Fixture scripts
  // are excluded from published desktop resources.
  if (process.env.SEAL_DESKTOP_SMOKE === "1" && process.env.SEAL_DESKTOP_SMOKE_STREAM === "1") {
    profile = (await import("../scripts/fixture-stream.mjs")).streamProfile(dataHome);
  }
  running = await startWebServer({ cwd, dataHome, pluginHome: dataHome, host: "127.0.0.1", port: 0, authenticate: true, ...(profile ? { profile } : {}) });
  if (stopping || !process.connected) { await running.close(); process.exit(0); }
  process.send({ type: "ready", url: running.launchUrl });
} catch (error) {
  process.send?.({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  process.disconnect();
}
