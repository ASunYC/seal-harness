import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** OS-owned exclusivity on Windows/Linux; no timeout may evict a live writer. */
async function processLease(root: string, name: string): Promise<(() => Promise<void>) | undefined> {
  if (process.platform !== "win32" && process.platform !== "linux") return undefined;
  const identity = process.platform === "win32" ? root.toLowerCase() : root;
  const key = createHash("sha256").update(`${identity}/${name}`).digest("hex");
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\seal-pi-${key}` : `\0seal-pi-${key}`;
  // This is an IPC mutex, not a command server. Never read or execute incoming data.
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen({ path: endpoint, exclusive: true }, accept);
  }).catch(error => { throw new Error(`PI session writer lease unavailable: ${name}`, { cause: error }); });
  server.unref();
  let closing: Promise<void> | undefined;
  return () => closing ??= new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
}

/** Only recover the old on-disk format with positive evidence its process exited. */
async function recoverLegacyLease(path: string, sealId: string): Promise<void> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  let owner: { pid?: number; sealSessionId?: string };
  try { owner = JSON.parse(raw); }
  catch { throw new Error(`PI session writer lease is unreadable; retained for inspection: ${path}`); }
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || owner.sealSessionId !== sealId) {
    throw new Error(`PI session writer lease ownership is invalid; retained for inspection: ${path}`);
  }
  try { process.kill(owner.pid!, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") { await unlink(path); return; }
    throw new Error(`Cannot verify PI session writer lease owner: ${path}`, { cause: error });
  }
  throw new Error(`PI session has an active legacy writer lease: ${path}`);
}

/** Exclusive native-session writer. Native JSONL is never removed during recovery. */
export async function openNativeSession(dataHome: string, sealId: string, cwd: string): Promise<{
  manager: SessionManager;
  release(): Promise<void>;
}> {
  const requestedRoot = join(resolve(dataHome), "pi-sessions");
  await mkdir(requestedRoot, { recursive: true });
  const root = await realpath(requestedRoot);
  const name = createHash("sha256").update(sealId).digest("hex");
  const file = join(root, `${name}.jsonl`);
  const leasePath = join(root, `${name}.lease`);
  const releaseProcess = await processLease(root, name);
  if (releaseProcess) {
    try { await recoverLegacyLease(leasePath, sealId); }
    catch (error) { await releaseProcess(); throw error; }
  }
  // Keep the file lease too so a previous Seal build cannot become a second writer.
  // Other platforms retain conservative file exclusivity without automatic recovery.
  let lease;
  try { lease = await open(leasePath, "wx", 0o600); }
  catch (error) {
    await releaseProcess?.();
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`PI session has an active or abandoned writer lease: ${leasePath}. Do not remove it while another Seal process is running.`);
    }
    throw error;
  }
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    try { await lease.close(); await unlink(leasePath); }
    finally { await releaseProcess?.(); }
  };
  try {
    await lease.writeFile(JSON.stringify({ pid: process.pid, sealSessionId: sealId, createdAt: new Date().toISOString() }));
    const manager = SessionManager.open(file, root, cwd);
    return { manager, release };
  } catch (error) { await release(); throw error; }
}
