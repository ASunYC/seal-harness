import { rename } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

/** Retry Windows sharing/access contention without deleting the destination. */
export async function renameSettings(source: string, destination: string, {
  platform = process.platform,
  move = rename,
  wait = (ms: number) => sleep(ms),
}: { platform?: NodeJS.Platform; move?: typeof rename; wait?: (ms: number) => Promise<void> } = {}): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await move(source, destination); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= 3) throw error;
      await wait(25 * 2 ** attempt);
    }
  }
}
