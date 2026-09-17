import { fork } from "node:child_process";

export function isLocalNavigation(value, origin) {
  try { const url = new URL(value); return url.origin === origin && !url.username && !url.password; }
  catch { return false; }
}

export function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function startBackend({ execPath, entry, cwd, dataHome, timeoutMs = 60_000, shutdownTimeoutMs = 8_000 }) {
  for (const value of [timeoutMs, shutdownTimeoutMs]) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Backend deadlines must be positive integer milliseconds");
  const child = fork(entry, [], {
    execPath, cwd, windowsHide: true, execArgv: [],
    env: { ...process.env, SEAL_DESKTOP_DATA_HOME: dataHome, SEAL_DESKTOP_WORKSPACE: cwd },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let stopping;
  const stop = () => stopping ??= new Promise(resolve => {
    if (!child.pid) return resolve();
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    // SIGTERM can be ignored on POSIX. After the IPC grace period, terminate
    // this owned child forcibly; never resolve stop before its exit event.
    const timer = setTimeout(() => child.kill("SIGKILL"), shutdownTimeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ type: "shutdown" }, () => {});
    else child.kill();
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("Seal backend startup timed out")), timeoutMs);
    const done = (error, value) => { clearTimeout(timer); child.off("message", message); child.off("error", failed); child.off("exit", exited); error ? reject(error) : resolve(value); };
    const failed = error => done(error);
    const exited = code => done(new Error(`Seal backend exited during startup (${code})`));
    const message = value => {
      if (value?.type === "failed") return done(new Error(value.message));
      if (value?.type !== "ready") return;
      try {
        const url = new URL(value.url);
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || !url.searchParams.get("token")) throw new Error("Invalid backend launch URL");
        done(undefined, url.href);
      } catch (error) { done(error); }
    };
    child.on("message", message); child.once("error", failed); child.once("exit", exited);
  }).catch(async error => { await stop(); throw error; });
  return { child, ready, stop };
}
