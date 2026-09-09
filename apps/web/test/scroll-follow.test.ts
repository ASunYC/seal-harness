import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/scroll-follow.js")).href;

describe("transcript bottom follow", () => {
  it("stays armed at the bottom and within the tolerance", async () => {
    const { isTranscriptNearBottom, TRANSCRIPT_BOTTOM_THRESHOLD } = await import(moduleUrl);
    expect(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 700, clientHeight: 300 })).toBe(true);
    expect(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 700 - TRANSCRIPT_BOTTOM_THRESHOLD, clientHeight: 300 })).toBe(true);
  });

  it("disarms once the reader moves beyond the tolerance", async () => {
    const { isTranscriptNearBottom } = await import(moduleUrl);
    expect(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 651, clientHeight: 300 })).toBe(false);
  });

  it("captures and restores a stable row anchor across reflow", async () => {
    const { captureTranscriptPosition, restoreTranscriptPosition, transcriptAnchorKey } = await import(moduleUrl);
    expect(transcriptAnchorKey({ role: "assistant", messageId: "m-1" })).toBe("assistant:m-1");
    expect(transcriptAnchorKey({ role: "turn-tail", turnId: "t-2" })).toBe("turn-tail:turn:t-2");
    const row = { dataset: { chatAnchorKey: "assistant:m-1" }, getBoundingClientRect: () => ({ top: 140, bottom: 190 }) };
    const scroller = { scrollTop: 360, getBoundingClientRect: () => ({ top: 100 }), querySelectorAll: () => [row] };
    const position = captureTranscriptPosition(scroller);
    expect(position).toEqual({ scrollTop: 360, anchorKey: "assistant:m-1", anchorTop: 40 });
    row.getBoundingClientRect = () => ({ top: 175, bottom: 225 });
    restoreTranscriptPosition(scroller, position);
    expect(scroller.scrollTop).toBe(395);
  });

  it("samples scroll bursts once and lets scrollend flush the final state", async () => {
    const { installTranscriptScrollSampling } = await import(moduleUrl);
    const listeners = new Map<string, () => void>(); let scheduled: (() => void) | undefined; let samples = 0; let clears = 0;
    const scroller = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    const timers = { setTimeout: (fn: () => void) => { scheduled = fn; return 7; }, clearTimeout: () => { clears += 1; } };
    const cleanup = installTranscriptScrollSampling(scroller, () => { samples += 1; }, 500, timers);
    listeners.get("scroll")?.(); listeners.get("scroll")?.();
    expect(samples).toBe(0);
    listeners.get("scrollend")?.();
    expect(samples).toBe(1); expect(clears).toBe(1);
    scheduled?.();
    expect(samples).toBe(1);
    cleanup();
    expect(listeners.size).toBe(0);
  });
});
