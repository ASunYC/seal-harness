import type { ChildProcess } from "node:child_process";

function exitsWithin(child: ChildProcess, milliseconds: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const onExit = (): void => { clearTimeout(timer); resolvePromise(true); };
    const timer = setTimeout(() => { child.removeListener("exit", onExit); resolvePromise(false); }, milliseconds).unref();
    child.once("exit", onExit);
  });
}

function forceTerminateWithin(child: ChildProcess, milliseconds: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    let accepted = false; let settled = false;
    const cleanup = (): void => { clearTimeout(timer); child.off("exit", onExit); child.off("error", onError); };
    const settle = (operation: () => void): void => { if (settled) return; settled = true; cleanup(); operation(); };
    const onExit = (): void => settle(resolvePromise);
    const onError = (error: Error): void => settle(() => reject(error));
    child.once("exit", onExit); child.once("error", onError);
    const timer = setTimeout(() => settle(() => reject(new Error(`Runtime process did not exit within ${milliseconds}ms after SIGKILL was ${accepted ? "accepted" : "refused"}`))), milliseconds).unref();
    try { accepted = child.kill("SIGKILL"); if (child.exitCode !== null || child.signalCode !== null) settle(resolvePromise); }
    catch (error) { settle(() => reject(new Error("SIGKILL failed", { cause: error }))); }
  });
}

/** Close stdin, then escalate through SIGTERM (POSIX) and SIGKILL until an exit is observed. */
export async function disposeRuntimeProcess(
  child: ChildProcess,
  graces: { readonly disposeEofGraceMs: number; readonly disposeGraceMs: number },
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  if (await exitsWithin(child, graces.disposeEofGraceMs)) return;
  if (platform !== "win32") {
    child.kill("SIGTERM");
    if (await exitsWithin(child, graces.disposeGraceMs)) return;
  }
  await forceTerminateWithin(child, graces.disposeGraceMs);
}
