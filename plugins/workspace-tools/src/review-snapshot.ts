import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { JsonObject, ReviewSnapshot, SessionId, ToolExecutionContext } from "@seal-harness/core";

const LIMIT = 2 * 1024 * 1024;
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const mutationTails = new Map<string, Promise<void>>();

/** Serializes native writes and rollback in this host, across sessions. */
async function withFileMutation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  let actual: string;
  try { actual = await realpath(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; actual = join(await realpath(dirname(path)), basename(path)); }
  const key = process.platform === "win32" ? actual.toLowerCase() : actual;
  const previous = mutationTails.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(() => undefined, () => undefined); mutationTails.set(key, tail);
  try { return await result; } finally { if (mutationTails.get(key) === tail) mutationTails.delete(key); }
}

/** Persist the original bytes before executing a write. No rollback authority. */
export async function reviewedWrite(
  root: string | undefined, path: string, relativePath: string, updated: string,
  context: ToolExecutionContext, write: () => Promise<void>, expectedBefore?: string,
): Promise<JsonObject | undefined> {
  return withFileMutation(path, async () => {
    context.signal.throwIfAborted();
    if (expectedBefore !== undefined && await readFile(path, "utf8") !== expectedBefore) throw new Error("File changed while preparing edit; read it again before retrying");
    return captureWrite(root, path, relativePath, updated, context, write);
  });
}

async function captureWrite(
  root: string | undefined, path: string, relativePath: string, updated: string,
  context: ToolExecutionContext, write: () => Promise<void>,
): Promise<JsonObject | undefined> {
  if (!root) { await write(); return undefined; }
  let before: Buffer | null = null;
  let tooLarge = Buffer.byteLength(updated) > LIMIT;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Review target is not a regular file");
    tooLarge ||= info.size > LIMIT;
    if (!tooLarge) before = await readFile(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (tooLarge || (before?.length ?? 0) > LIMIT) {
    await write();
    return { available: false, reason: "snapshot-size-limit", maxBytes: LIMIT };
  }
  const id = randomUUID();
  // Hash session IDs so arbitrary IDs cannot become filesystem path segments.
  const directory = join(root, hash(String(context.sessionId)), id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (before !== null) await writeFile(join(directory, "before"), before, { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "after"), updated, { flag: "wx", mode: 0o600 });
  const record = {
    version: 1, id, sessionId: context.sessionId, callId: context.callId,
    cwd: context.cwd, path: relativePath, createdAt: new Date().toISOString(),
    existed: before !== null, beforeHash: before === null ? null : hash(before),
    afterHash: hash(updated), beforeBytes: before?.length ?? 0, afterBytes: Buffer.byteLength(updated),
  };
  await writeFile(join(directory, "meta.json"), JSON.stringify({ ...record, status: "prepared" }), { flag: "wx", mode: 0o600 });
  context.signal.throwIfAborted();
  await write();
  // Never claim a verified applied change if an external writer changed it.
  const actual = await readFile(path);
  const status = hash(actual) === record.afterHash ? "applied" : "conflict";
  await writeFile(join(directory, "meta.next.json"), JSON.stringify({ ...record, status }), { flag: "wx", mode: 0o600 });
  await rename(join(directory, "meta.next.json"), join(directory, "meta.json"));
  return { available: true, snapshotId: id, status, beforeHash: record.beforeHash, afterHash: record.afterHash, beforeBytes: record.beforeBytes, afterBytes: record.afterBytes };
}

/** Reads only immutable evidence, never the mutable workspace file. */
export async function readReviewSnapshot(root: string | undefined, sessionId: SessionId, id: string): Promise<ReviewSnapshot | undefined> {
  if (!root || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return undefined;
  try {
    const base = await realpath(root);
    const directory = join(base, hash(String(sessionId)), id);
    async function bounded(name: string, limit: number) {
      const path = await realpath(join(directory, name)); const rel = relative(base, path);
      if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw new Error("Review snapshot escapes data directory");
      const info = await stat(path);
      if (!info.isFile() || info.size > limit) throw new Error("Invalid review snapshot size");
      const bytes = await readFile(path); if (bytes.length > limit) throw new Error("Invalid review snapshot size"); return bytes;
    }
    const record = JSON.parse((await bounded("meta.json", 32_768)).toString("utf8"));
    if (record.version !== 1 || record.id !== id || record.sessionId !== sessionId || !["applied", "conflict", "rolled-back"].includes(record.status)) return undefined;
    if (typeof record.path !== "string" || typeof record.callId !== "string" || typeof record.createdAt !== "string" || typeof record.existed !== "boolean") throw new Error("Invalid review snapshot metadata");
    const before = record.existed ? await bounded("before", LIMIT) : null;
    const after = await bounded("after", LIMIT);
    if ((before === null ? null : hash(before)) !== record.beforeHash || hash(after) !== record.afterHash) throw new Error("Review snapshot checksum mismatch");
    // This surface is text-only. Do not display a lossy replacement as evidence.
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return { id, callId: record.callId, path: record.path, createdAt: record.createdAt, status: record.status, existed: record.existed, before: before === null ? null : decoder.decode(before), after: decoder.decode(after) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Internal storage operation; callers must authorize the owning session first. */
export async function rollbackReviewSnapshot(root: string, sessionId: SessionId, id: string, cwd: string): Promise<"rolled-back" | "already-rolled-back" | "conflict" | "unavailable" | "busy"> {
  const initial = await readReviewSnapshot(root, sessionId, id);
  if (!initial) return "unavailable";
  const workspace = await realpath(cwd); const target = resolve(workspace, initial.path); const rel = relative(workspace, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return "unavailable";
  try { return await withFileMutation(target, () => rollbackLocked(root, sessionId, id, cwd)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "conflict"; throw error; }
}

async function rollbackLocked(root: string, sessionId: SessionId, id: string, cwd: string): Promise<"rolled-back" | "already-rolled-back" | "conflict" | "unavailable" | "busy"> {
  const directory = join(root, hash(String(sessionId)), id);
  const lock = join(directory, "rollback.lock");
  if (!await acquireRollbackLock(lock)) return "busy";
  try {
    const snapshot = await readReviewSnapshot(root, sessionId, id);
    if (!snapshot) return "unavailable";
    const metaPath = join(directory, "meta.json");
    const record = JSON.parse(await readFile(metaPath, "utf8"));
    const workspace = await realpath(cwd);
    if (typeof record.cwd !== "string" || await realpath(record.cwd) !== workspace) return "unavailable";
    if (snapshot.status === "rolled-back") return "already-rolled-back";
    if (snapshot.status !== "applied") return "unavailable";
    const target = resolve(workspace, snapshot.path); const rel = relative(workspace, target);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return "unavailable";
    let currentHash: string | null = null;
    try {
      // Refuse symlinks, redirected parents, special files, and later edits.
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size > LIMIT || await realpath(target) !== target) return "conflict";
      currentHash = hash(await readFile(target));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const recovered = record.rollbackPending === true && currentHash === record.beforeHash;
    if (!recovered) {
      if (currentHash !== record.afterHash) return "conflict";
      // Journal intent before touching the file so a retry can recognize that
      // bytes were already restored even if metadata completion was interrupted.
      const pending = join(directory, `meta.pending-${randomUUID()}.json`);
      await writeFile(pending, JSON.stringify({ ...record, rollbackPending: true }), { flag: "wx", mode: 0o600 });
      await rename(pending, metaPath);
      if (snapshot.before === null) await unlink(target);
      else await writeFile(target, snapshot.before, "utf8");
    }
    const next = join(directory, `meta.rollback-${randomUUID()}.json`);
    await writeFile(next, JSON.stringify({ ...record, rollbackPending: false, status: "rolled-back", rolledBackAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    await rename(next, metaPath);
    return "rolled-back";
  } finally { await unlink(join(lock, "owner.json")); await rmdir(lock); }
}

async function acquireRollbackLock(lock: string): Promise<boolean> {
  async function create() {
    try { await mkdir(lock); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
    return true;
  }
  if (await create()) return true;
  // Recovery itself is exclusive; an ambiguous or reused PID fails closed.
  const recovery = `${lock}.recovery`;
  try { await mkdir(recovery); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  try {
    let owner;
    try { owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8")); } catch { return false; }
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    const retired = `${lock}.retired-${randomUUID()}`;
    await rename(lock, retired);
    // Remove only our known lock metadata, never recursively delete contents.
    await unlink(join(retired, "owner.json")); await rmdir(retired);
    return await create();
  } finally { await rmdir(recovery); }
}
