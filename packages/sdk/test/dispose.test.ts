import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { disposeRuntimeProcess } from "../src/index.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: NodeJS.Signals[] = [];
  readonly stdin = { end: (): void => { this.onTrigger("eof"); } };
  constructor(readonly diesOn?: "eof" | NodeJS.Signals) { super(); }
  kill(signal: NodeJS.Signals): boolean { this.kills.push(signal); this.onTrigger(signal); return true; }
  private onTrigger(trigger: "eof" | NodeJS.Signals): void {
    if (trigger !== "SIGKILL" && trigger !== this.diesOn) return;
    queueMicrotask(() => { if (trigger === "eof") this.exitCode = 0; else this.signalCode = trigger; this.emit("exit"); });
  }
}

const child = (value: FakeChild): ChildProcess => value as unknown as ChildProcess;

describe("disposeRuntimeProcess", () => {
  it("stops at cooperative EOF when the runtime exits", async () => {
    const value = new FakeChild("eof"); await disposeRuntimeProcess(child(value), { disposeEofGraceMs: 50, disposeGraceMs: 50 });
    expect(value.exitCode).toBe(0); expect(value.kills).toEqual([]);
  });

  it("uses SIGTERM before SIGKILL on POSIX and skips it on Windows", async () => {
    const posix = new FakeChild("SIGTERM"); await disposeRuntimeProcess(child(posix), { disposeEofGraceMs: 1, disposeGraceMs: 50 }, "linux");
    expect(posix.kills).toEqual(["SIGTERM"]);
    const windows = new FakeChild(); await disposeRuntimeProcess(child(windows), { disposeEofGraceMs: 1, disposeGraceMs: 50 }, "win32");
    expect(windows.kills).toEqual(["SIGKILL"]); expect(windows.signalCode).toBe("SIGKILL");
  });

  it("rejects when forced termination is refused without an exit edge", async () => {
    const value = new FakeChild(); vi.spyOn(value, "kill").mockImplementation((signal) => { value.kills.push(signal); return false; });
    await expect(disposeRuntimeProcess(child(value), { disposeEofGraceMs: 1, disposeGraceMs: 5 }, "win32")).rejects.toThrow("SIGKILL was refused");
    expect(value.listenerCount("exit")).toBe(0); expect(value.listenerCount("error")).toBe(0);
  });
});
