// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/attachment-rail.js")).href;

describe("composer attachment rail", () => {
  it("normalizes DSH wheel and page distances", async () => {
    const { attachmentPageDistance, attachmentWheelDistance } = await import(moduleUrl);
    expect(attachmentPageDistance(500, 1)).toBe(436); expect(attachmentPageDistance(100, -1)).toBe(-200);
    expect(attachmentWheelDistance({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 500)).toBe(60);
    expect(attachmentWheelDistance({ deltaX: 2, deltaY: 1, deltaMode: 1 }, 500)).toBe(32);
    expect(attachmentWheelDistance({ deltaX: 4, deltaY: 0, deltaMode: 0 }, 500)).toBeNull();
  });

  it("renders thumbnails with open and remove controls", async () => {
    const dom = globalThis as any; dom.matchMedia = () => ({ matches: false }); const remove = vi.fn();
    const { createAttachmentRail } = await import(moduleUrl); const root = createAttachmentRail([{ id: "a", name: "a.png", src: "a.png" }], { onRemove: remove }); dom.document.body.append(root); await Promise.resolve();
    expect(root.getAttribute("role")).toBe("group"); expect(root.querySelectorAll("img")).toHaveLength(1); root.querySelector(".attachment-rail-remove").click(); expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    root.querySelector(".attachment-rail-open").focus(); root.querySelector(".attachment-rail-open").click(); expect(dom.document.querySelector(".image-lightbox")).not.toBeNull(); dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("uses localized accessible labels for the rail and lightbox", async () => {
    const dom = globalThis as any; dom.matchMedia = () => ({ matches: false }); const remove = vi.fn();
    const { createAttachmentRail } = await import(moduleUrl); const root = createAttachmentRail([{ name: "图.png", src: "image.png" }], { onRemove: remove, labels: { group: "待发送图片", open: "查看原图", openNamed: (name: string) => `${name}，点击查看原图`, removeNamed: (name: string) => `移除图片 ${name}`, scrollLeft: "向左滚动图片", scrollRight: "向右滚动图片", lightbox: { dialog: "原图预览", close: "关闭原图预览" } } }); dom.document.body.append(root); await Promise.resolve();
    expect(root.getAttribute("aria-label")).toBe("待发送图片"); expect(root.querySelector(".attachment-rail-open").getAttribute("aria-label")).toBe("图.png，点击查看原图"); expect(root.querySelector(".attachment-rail-remove").getAttribute("aria-label")).toBe("移除图片 图.png");
    root.querySelector(".attachment-rail-open").click(); expect(dom.document.querySelector(".image-lightbox")?.getAttribute("aria-label")).toBe("原图预览"); expect(dom.document.querySelector(".image-lightbox-close")?.getAttribute("aria-label")).toBe("关闭原图预览"); dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("locks both mutation and preview controls during submission admission", async () => {
    const dom = globalThis as any; const { createAttachmentRail } = await import(moduleUrl); const root = createAttachmentRail([{ name: "a.png", src: "a.png" }], { locked: true }); dom.document.body.append(root); await Promise.resolve();
    expect(root.querySelector(".attachment-rail-open").disabled).toBe(true); expect(root.querySelector(".attachment-rail-remove").disabled).toBe(true);
  });
});
