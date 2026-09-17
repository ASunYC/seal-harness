import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
const url = pathToFileURL(resolve(process.cwd(), "apps/web/public/child-history.js")).href;
const page = (messages: unknown[], before: number | null = null) => ({ messages, window: { nextBefore: before, hasMore: before !== null } });
describe("child history controller", () => {
  it("drops transient previews when freezing older history", async () => {
    const { createChildHistory } = await import(url);
    const fetchPage = vi.fn().mockResolvedValueOnce(page([{ id: "saved" }, { live: true, id: "partial" }], 1)).mockResolvedValueOnce(page([{ id: "older" }]));
    const onPage = vi.fn();
    const controller = createChildHistory({ fetchPage, onPage, onError: vi.fn() });
    await controller.load(); await controller.load("older");
    expect(onPage.mock.lastCall?.[0].messages).toEqual([{ id: "older" }, { id: "saved" }]);
    controller.dispose();
  });
  it("does not apply a background response after the reader scrolls away", async () => {
    const { createChildHistory } = await import(url);
    let finish: any; let allowed = true;
    const fetchPage = vi.fn().mockResolvedValueOnce(page(["initial"]))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(page(["updated"]));
    const onPage = vi.fn();
    const controller = createChildHistory({ fetchPage, onPage, onError: vi.fn(), canPoll: () => allowed });
    await controller.load(); const update = controller.load("poll");
    await controller.load("poll"); allowed = false; finish(page(["updated"])); await update;
    expect(onPage).toHaveBeenCalledTimes(1); expect(fetchPage).toHaveBeenCalledTimes(2);
    allowed = true; await controller.load("poll");
    expect(onPage.mock.lastCall?.[0].messages).toEqual(["updated"]);
    controller.dispose();
  });
  it("refreshes after reconnect and removes the reconnect listener on close", async () => {
    vi.useFakeTimers();
    try {
      const { watchChildHistory } = await import(url); const target = new EventTarget(), refresh = vi.fn();
      const stop = watchChildHistory({ sessionId: "child", target, refresh, canRefresh: () => true });
      target.dispatchEvent(new Event("seal-harness:events-connected")); await vi.advanceTimersByTimeAsync(150);
      expect(refresh).toHaveBeenCalledTimes(1); stop();
      target.dispatchEvent(new Event("seal-harness:events-connected")); await vi.advanceTimersByTimeAsync(150);
      expect(refresh).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("coalesces a notification received during an in-flight read", async () => {
    const { createChildHistory } = await import(url);
    let finish: any;
    const fetchPage = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(page(["newer"]));
    const controller = createChildHistory({ fetchPage, onPage: vi.fn(), onError: vi.fn() });
    const first = controller.load(); await controller.load("poll"); await controller.load("poll");
    finish(page(["old"])); await first; await Promise.resolve();
    expect(fetchPage).toHaveBeenCalledTimes(2); controller.dispose();
  });
  it("filters and coalesces session notifications and cleans up timers", async () => {
    vi.useFakeTimers();
    try {
      const { watchChildHistory } = await import(url);
      const target = new EventTarget(); const refresh = vi.fn(); let allowed = true;
      const stop = watchChildHistory({ sessionId: "child", target, refresh, canRefresh: () => allowed });
      const send = (sessionId: string) => target.dispatchEvent(new CustomEvent("seal-harness:session-appended", { detail: { sessionId } }));
      send("other"); await vi.advanceTimersByTimeAsync(200); expect(refresh).not.toHaveBeenCalled();
      send("child"); send("child"); await vi.advanceTimersByTimeAsync(150); expect(refresh).toHaveBeenCalledTimes(1);
      allowed = false; send("child"); await vi.advanceTimersByTimeAsync(10000); expect(refresh).toHaveBeenCalledTimes(1);
      allowed = true; send("child"); stop(); await vi.advanceTimersByTimeAsync(20000); send("child");
      expect(refresh).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("loads older pages in order and pauses polling until latest is requested", async () => {
    const { createChildHistory } = await import(url);
    const fetchPage = vi.fn().mockResolvedValueOnce(page(["new"], 12)).mockResolvedValueOnce(page(["old"])).mockResolvedValueOnce(page(["new", "latest"], 13));
    const onPage = vi.fn(); const controller = createChildHistory({ fetchPage, onPage, onError: vi.fn() });
    await controller.load(); await controller.load("older"); await controller.load("poll");
    expect(fetchPage.mock.calls).toEqual([[null], [12]]);
    expect(onPage.mock.lastCall?.[0].messages).toEqual(["old", "new"]);
    await controller.load(); expect(onPage.mock.lastCall?.[0].messages).toEqual(["new", "latest"]);
  });
  it("does not redraw unchanged polling responses", async () => {
    const { createChildHistory } = await import(url);
    const onPage = vi.fn(); const controller = createChildHistory({ fetchPage: async () => page(["same"]), onPage, onError: vi.fn() });
    await controller.load(); await controller.load("poll"); expect(onPage).toHaveBeenCalledTimes(1);
  });
  it("serializes reads and ignores results after close", async () => {
    const { createChildHistory } = await import(url);
    let finish: any; const fetchPage = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onPage = vi.fn(); const controller = createChildHistory({ fetchPage, onPage, onError: vi.fn() });
    const pending = controller.load(); await controller.load("poll");
    expect(fetchPage).toHaveBeenCalledTimes(1); controller.dispose(); finish(page(["late"])); await pending;
    await controller.load(); expect(onPage).not.toHaveBeenCalled(); expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it("retains history and permits retry after an older-page failure", async () => {
    const { createChildHistory } = await import(url);
    const fetchPage = vi.fn().mockResolvedValueOnce(page(["new"], 4)).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page(["old"]));
    const onPage = vi.fn(), onError = vi.fn(); const controller = createChildHistory({ fetchPage, onPage, onError });
    await controller.load(); await controller.load("older"); expect(onError).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1); await controller.load("older");
    expect(fetchPage.mock.calls).toEqual([[null], [4], [4]]); expect(onPage.mock.lastCall?.[0].messages).toEqual(["old", "new"]);
  });
});
