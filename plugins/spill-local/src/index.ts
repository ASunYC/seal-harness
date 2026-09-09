import { chmod, lstat, mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spillStoreToken, type SaveTextSpill, type SpillRef, type SpillStore } from "@seal-harness/core";
import { definePlugin, type PluginContext } from "@seal-harness/kernel";

export interface LocalSpillConfig { readonly root?: string; readonly cleanupPeriodDays?: number }

export class LocalSpillStore implements SpillStore {
  readonly root: string;
  constructor(root?: string) { this.root = resolve(root ?? join(tmpdir(), `seal-spill-${process.pid}`)); }

  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    const session = createHash("sha256").update(input.owner.sessionId).digest("hex").slice(0, 12);
    const directory = join(this.root, `session-${session}`);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.root, 0o700);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("spill session directory must not be a symbolic link");
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const safeName = input.suggestedName.replace(/[^A-Za-z0-9._~-]/g, "_").replace(/^\.+/, "").slice(-80) || "result.txt";
    const path = join(directory, `${randomBytes(6).toString("hex")}-${safeName}`);
    const handle = await open(path, "wx", 0o600);
    try { await handle.writeFile(input.content, "utf8"); } finally { await handle.close(); }
    return { locator: path, bytes: Buffer.byteLength(input.content, "utf8"), retrievalHint: "Use read with offset/limit, or search this path to inspect the full result." };
  }
}

async function cleanup(root: string, cutoff: number): Promise<void> {
  let sessions; try { sessions = await readdir(root, { withFileTypes: true }); } catch { return; }
  await Promise.all(sessions.filter((entry) => entry.isDirectory() && entry.name.startsWith("session-")).map(async (entry) => {
    const directory = join(root, entry.name);
    let files; try { files = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const file of files) {
      if (!file.isFile()) continue;
      const path = join(directory, file.name);
      try { if ((await stat(path)).mtimeMs < cutoff) await rm(path); } catch { /* best effort */ }
    }
  }));
}

export const localSpillPlugin = definePlugin<LocalSpillConfig>({
  name: "spill-local",
  provides: [spillStoreToken],
  setup(context: PluginContext, config) {
    const days = config.cleanupPeriodDays ?? 30;
    if (!Number.isInteger(days) || days < 0) throw new TypeError("cleanupPeriodDays must be a non-negative integer");
    const store = new LocalSpillStore(config.root);
    context.provide(spillStoreToken, store);
    if (days > 0) void cleanup(store.root, Date.now() - days * 86_400_000);
  },
});
