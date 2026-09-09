import { describe, expect, it, vi } from "vitest";

describe("message copy action", () => {
  it("coalesces clicks while writing and during the one-second success window", async () => {
    vi.useFakeTimers();
    const { createCopyAction } = await import(new URL("../public/copy-action.js", import.meta.url).href);
    let release!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const reset = vi.fn();
    const action = createCopyAction({ write, copied: vi.fn(), reset, failed: vi.fn() });
    const first = action.activate("hello");
    expect(action.state()).toBe("pending");
    expect(await action.activate("again")).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    release(); await expect(first).resolves.toBe(true);
    expect(action.state()).toBe("copied");
    expect(await action.activate("again")).toBe(false);
    await vi.advanceTimersByTimeAsync(999); expect(reset).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(reset).toHaveBeenCalledOnce();
    expect(action.state()).toBe("idle");
    vi.useRealTimers();
  });

  it("reports write failures and permits a retry", async () => {
    const { createCopyAction } = await import(new URL("../public/copy-action.js", import.meta.url).href);
    const failure = new Error("denied");
    const write = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const copied = vi.fn(); const failed = vi.fn();
    const action = createCopyAction({ write, copied, reset: vi.fn(), failed });
    await expect(action.activate("hello")).resolves.toBe(false);
    expect(failed).toHaveBeenCalledWith(failure);
    await expect(action.activate("hello")).resolves.toBe(true);
    expect(copied).toHaveBeenCalledOnce(); action.dispose();
  });

  it("invalidates a clipboard completion that arrives after disposal", async () => {
    const { createCopyAction } = await import(new URL("../public/copy-action.js", import.meta.url).href);
    let release!: () => void;
    const copied = vi.fn(); const reset = vi.fn(); const failed = vi.fn();
    const action = createCopyAction({ write: () => new Promise<void>((resolve) => { release = resolve; }), copied, reset, failed });
    const pending = action.activate("hello"); action.dispose(); release();
    await expect(pending).resolves.toBe(false);
    expect(action.state()).toBe("disposed");
    expect(copied).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
});
