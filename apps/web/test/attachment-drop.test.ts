// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/attachment-drop.js")).href;
const drag = (window: any, type: string, dataTransfer: any, target?: any) => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientX: { value: 20 }, clientY: { value: 20 } }); (target || window.document).dispatchEvent(event); return event; };

describe("attachment drop overlay", () => {
  it("recognizes only transfers that advertise files", async () => {
    const { isFileTransfer } = await import(moduleUrl); expect(isFileTransfer({ types: ["text/plain"] })).toBe(false); expect(isFileTransfer({ types: ["Files"] })).toBe(true);
  });

  it("tracks nested drags, sets drop effect, admits once, and cleans up", async () => {
    const dom = globalThis as any; const { document, window } = dom; const onFiles = vi.fn(); const transfer: any = { types: ["Files"], files: [{ name: "a.png" }], dropEffect: "none" };
    const { installAttachmentDrop } = await import(moduleUrl); const cleanup = installAttachmentDrop({ canAccept: () => true, onFiles });
    drag(window, "dragenter", transfer); drag(window, "dragenter", transfer); expect(document.querySelectorAll(".attachment-drop-overlay")).toHaveLength(1);
    drag(window, "dragleave", transfer); expect(document.querySelector(".attachment-drop-overlay")).not.toBeNull();
    drag(window, "dragover", transfer); expect(transfer.dropEffect).toBe("copy");
    drag(window, "drop", transfer); expect(onFiles).toHaveBeenCalledWith(transfer.files); expect(document.querySelector(".attachment-drop-overlay")).toBeNull(); cleanup();
  });

  it("shows a blocked state and refuses a disabled drop", async () => {
    const dom = globalThis as any; const { document, window } = dom; const onFiles = vi.fn(); const transfer: any = { types: ["Files"], files: [{}], dropEffect: "copy" };
    const { installAttachmentDrop } = await import(moduleUrl); const cleanup = installAttachmentDrop({ canAccept: () => false, onFiles });
    drag(window, "dragenter", transfer); expect(document.querySelector(".attachment-drop-overlay")?.dataset.disabled).toBe("true"); drag(window, "dragover", transfer); expect(transfer.dropEffect).toBe("none"); drag(window, "drop", transfer); expect(onFiles).not.toHaveBeenCalled(); cleanup();
  });

  it("resolves localized labels when each overlay opens", async () => {
    const dom = globalThis as any; const { document, window } = dom; const transfer: any = { types: ["Files"], files: [], dropEffect: "none" }; let title = "First";
    const { installAttachmentDrop } = await import(moduleUrl); const cleanup = installAttachmentDrop({ canAccept: () => true, onFiles: vi.fn(), labels: () => ({ title }) });
    drag(window, "dragenter", transfer); expect(document.querySelector(".attachment-drop-overlay strong")?.textContent).toBe("First"); drag(window, "drop", transfer);
    title = "第二次"; drag(window, "dragenter", transfer); expect(document.querySelector(".attachment-drop-overlay strong")?.textContent).toBe("第二次"); cleanup();
  });
});
