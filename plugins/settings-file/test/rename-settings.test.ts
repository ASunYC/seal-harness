import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { renameSettings } from "../src/rename-settings.js";

it("keeps old settings available during contention then atomically replaces them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seal-settings-rename-"));
  const source = join(dir, "pending"), destination = join(dir, "settings.yaml");
  try {
    await writeFile(source, "new"); await writeFile(destination, "old");
    const move = vi.fn<typeof rename>().mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EPERM" })).mockImplementation(rename);
    const wait = vi.fn(async () => { expect(await readFile(destination, "utf8")).toBe("old"); });
    await renameSettings(source, destination, { platform: "win32", move, wait });
    expect(await readFile(destination, "utf8")).toBe("new");
    expect(wait).toHaveBeenCalledWith(25); expect(move).toHaveBeenCalledTimes(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("bounds retries and propagates the original error", async () => {
  const error = Object.assign(new Error("still locked"), { code: "EACCES" });
  const move = vi.fn<typeof rename>().mockRejectedValue(error), wait = vi.fn(async (_ms: number) => {});
  await expect(renameSettings("source", "target", { platform: "win32", move, wait })).rejects.toBe(error);
  expect(move).toHaveBeenCalledTimes(4); expect(wait.mock.calls.map(call => call[0])).toEqual([25, 50, 100]);
});
it.each(["ENOENT", "ENOSPC", "EXDEV"])("does not retry %s", async code => {
  const move = vi.fn<typeof rename>().mockRejectedValue(Object.assign(new Error(code), { code }));
  await expect(renameSettings("source", "target", { platform: "win32", move })).rejects.toThrow(code);
  expect(move).toHaveBeenCalledTimes(1);
});
it("does not retry Unix permission failures", async () => {
  const move = vi.fn<typeof rename>().mockRejectedValue(Object.assign(new Error("denied"), { code: "EPERM" }));
  await expect(renameSettings("source", "target", { platform: "linux", move })).rejects.toThrow("denied");
  expect(move).toHaveBeenCalledTimes(1);
});
