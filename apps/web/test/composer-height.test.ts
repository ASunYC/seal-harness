import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/composer-height.js")).href;

describe("composer text geometry", () => {
  it("grows from the resting floor to the shared seat cap", async () => {
    const { composerTextGeometry } = await import(moduleUrl);
    expect(composerTextGeometry(20)).toEqual({ height: 62, overflowY: "hidden" });
    expect(composerTextGeometry(180)).toEqual({ height: 180, overflowY: "hidden" });
    expect(composerTextGeometry(500)).toEqual({ height: 336, overflowY: "auto" });
  });

  it("publishes live seat and scrollport measurements", async () => {
    const { observeComposerSeat } = await import(moduleUrl);
    const values = new Map<string, string>();
    const scroller = {
      clientHeight: 720,
      style: { setProperty: (name: string, value: string) => values.set(name, value) },
    };
    const seat = { offsetHeight: 188 };
    const observed: unknown[] = [];
    let callback = () => {};
    let disconnected = false;
    let resizeCount = 0;
    class Observer {
      constructor(next: () => void) { callback = next; }
      observe(target: unknown) { observed.push(target); }
      disconnect() { disconnected = true; }
    }
    const cleanup = observeComposerSeat(seat, scroller, Observer, () => { resizeCount += 1; });
    expect(values.get("--dsh-composer-height")).toBe("188px");
    expect(values.get("--dsh-conversation-viewport-height")).toBe("720px");
    expect(observed).toEqual([seat, scroller]);
    expect(resizeCount).toBe(1);
    seat.offsetHeight = 244;
    callback();
    expect(values.get("--dsh-composer-height")).toBe("244px");
    expect(resizeCount).toBe(2);
    cleanup();
    expect(disconnected).toBe(true);
  });
});
