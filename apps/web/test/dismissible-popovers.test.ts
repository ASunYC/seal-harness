// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { anchoredPopoverPosition, installDismissiblePopovers } from "../public/dismissible-popovers.js";

afterEach(() => { document.body.replaceChildren(); });

function fixture() {
  document.body.innerHTML = '<details data-dismissible-popover open><summary aria-expanded="true">Usage</summary><dl><dt>Input</dt><dd>1</dd></dl></details><button id="outside">Outside</button>';
  return document.querySelector("details") as HTMLDetailsElement;
}

describe("dismissible action popovers", () => {
  it("anchors above the trigger and clamps the panel inside a 12px viewport margin", () => {
    expect(anchoredPopoverPosition({ left: 400, top: 500, bottom: 528 }, { width: 300, height: 200 }, { width: 800, height: 600 }, { side: "top", gap: 8 })).toEqual({ left: 400, top: 292 });
    expect(anchoredPopoverPosition({ left: -40, top: 40, bottom: 68 }, { width: 300, height: 200 }, { width: 320, height: 240 }, { side: "top", gap: 8 })).toEqual({ left: 12, top: 12 });
    expect(anchoredPopoverPosition({ left: 1200, top: 900, bottom: 928 }, { width: 300, height: 200 }, { width: 800, height: 600 }, { side: "top", gap: 8 })).toEqual({ left: 488, top: 388 });
  });

  it("anchors feedback editors below the trigger with the default four-pixel gap", () => {
    expect(anchoredPopoverPosition({ left: 100, top: 50, bottom: 78 }, { width: 300, height: 120 }, { width: 800, height: 600 })).toEqual({ left: 100, top: 82 });
  });

  it("closes an open popover on an outside pointerdown", () => {
    const dispose = installDismissiblePopovers(document); const details = fixture();
    document.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(details.open).toBe(false); expect(details.querySelector("summary")!.getAttribute("aria-expanded")).toBe("false"); dispose();
  });

  it("keeps the popover open for a pointerdown inside it", () => {
    const dispose = installDismissiblePopovers(document); const details = fixture();
    details.querySelector("dd")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(details.open).toBe(true); dispose();
  });

  it("closes on Escape and restores focus to the trigger when focus was inside", () => {
    const dispose = installDismissiblePopovers(document); const details = fixture(); const trigger = details.querySelector("summary") as HTMLElement;
    trigger.focus(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(details.open).toBe(false); expect(document.activeElement).toBe(trigger); dispose();
  });

  it("removes its document listeners when disposed", () => {
    const dispose = installDismissiblePopovers(document); const details = fixture(); dispose();
    document.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(details.open).toBe(true);
  });

  it("dismisses a generic editor and synchronizes its trigger", () => {
    const dispose = installDismissiblePopovers(document);
    document.body.innerHTML = '<div data-dismissible-popover-root data-popover-open><button data-dismissible-trigger aria-expanded="true">Note</button><form role="dialog"><textarea></textarea></form></div><button id="outside">Outside</button>';
    const root = document.querySelector("[data-dismissible-popover-root]") as HTMLElement; const trigger = root.querySelector("button")!;
    document.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(root.hasAttribute("data-popover-open")).toBe(false); expect(root.querySelector("form")).toBeNull(); expect(trigger.getAttribute("aria-expanded")).toBe("false"); dispose();
  });

  it("keeps a pending generic editor open while its mutation is locked", () => {
    const dispose = installDismissiblePopovers(document);
    document.body.innerHTML = '<div data-dismissible-popover-root data-popover-open data-dismissible-locked="true"><button data-dismissible-trigger aria-expanded="true">Note</button><form role="dialog"></form></div><button id="outside">Outside</button>';
    const root = document.querySelector("[data-dismissible-popover-root]") as HTMLElement;
    document.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(root.hasAttribute("data-popover-open")).toBe(true); expect(root.querySelector("form")).not.toBeNull(); dispose();
  });

  it("observes open panel size changes and disconnects the observer on close", () => {
    const observed: Element[] = []; let disconnected = 0;
    Object.defineProperty(window, "ResizeObserver", { configurable: true, value: class { observe(node: Element) { observed.push(node); } disconnect() { disconnected += 1; } } });
    document.body.innerHTML = '<details data-dismissible-popover open><summary>Usage</summary><dl role="dialog"></dl></details><button id="outside">Outside</button>';
    const dispose = installDismissiblePopovers(document); expect(observed).toEqual([document.querySelector("dl")]);
    document.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(disconnected).toBe(1); dispose();
    Reflect.deleteProperty(window, "ResizeObserver");
  });

  it("uses the same cleanup path when a generic editor closes itself", () => {
    let disconnected = 0; Object.defineProperty(window, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() { disconnected += 1; } } });
    document.body.innerHTML = '<div data-dismissible-popover-root data-popover-open><button data-dismissible-trigger>Note</button><form role="dialog"></form></div>';
    const root = document.querySelector("div")!; const dispose = installDismissiblePopovers(document);
    root.dispatchEvent(new CustomEvent("dismissible-popover-close", { bubbles: true })); expect(root.querySelector("form")).toBeNull(); expect(disconnected).toBe(1); dispose(); Reflect.deleteProperty(window, "ResizeObserver");
  });
});
