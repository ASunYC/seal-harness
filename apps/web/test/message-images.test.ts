// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/message-images.js")).href;

describe("message image gallery", () => {
  it("matches the DSH single-image sizing and crop anchors", async () => {
    const { singleImageFit } = await import(moduleUrl);
    expect(singleImageFit({ width: 800, height: 100 })).toEqual({ width: 240, height: 60, objectPosition: "left center" });
    expect(singleImageFit({ width: 100, height: 800 })).toEqual({ width: 60, height: 240, objectPosition: "center top" });
    expect(singleImageFit({ width: 120, height: 80 })).toEqual({ width: 120, height: 80, objectPosition: "center" });
  });

  it("renders 64px gallery tiles and an accessible dismissible lightbox", async () => {
    const { createMessageImageGallery } = await import(moduleUrl);
    const dom = globalThis as any; const document = dom.document; const window = dom.window;
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    const gallery = createMessageImageGallery([{ src: "one.png", alt: "One" }, { src: "two.png", alt: "Two" }]);
    document.body.append(gallery); expect(gallery.dataset.variant).toBe("tile"); expect(gallery.querySelectorAll(".message-image-frame")).toHaveLength(2);
    const firstImage = gallery.querySelector("img"); firstImage.dispatchEvent(new window.Event("load")); gallery.querySelector("button").focus(); gallery.querySelector("button").click();
    const dialog = document.querySelector(".image-lightbox"); expect(dialog?.getAttribute("role")).toBe("dialog"); expect(document.activeElement?.className).toBe("image-lightbox-close");
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })); expect(document.querySelector(".image-lightbox")).toBeNull(); expect(document.activeElement).toBe(gallery.querySelector("button"));
  });

  it("shows a retry control after load failure and rearms the same source", async () => {
    const dom = globalThis as any; const document = dom.document; const window = dom.window; const { createMessageImageGallery } = await import(moduleUrl);
    const gallery = createMessageImageGallery([{ src: "broken.png", alt: "Broken" }], { loading: "Loading", loadFailed: "Retry image" }); document.body.append(gallery); const button = gallery.querySelector("button"); const image = gallery.querySelector("img");
    expect(button.textContent).toBe("Loading"); image.dispatchEvent(new window.Event("error")); expect(button.textContent).toBe("Retry image"); expect(button.classList.contains("error")).toBe(true);
    button.click(); await Promise.resolve(); expect(button.textContent).toBe("Loading"); expect(image.src).toContain("broken.png"); image.dispatchEvent(new window.Event("load")); expect(image.hidden).toBe(false);
  });

  it("carries localized labels through the thumbnail and lightbox", async () => {
    const dom = globalThis as any; const document = dom.document; const window = dom.window; const { createMessageImageGallery } = await import(moduleUrl);
    const gallery = createMessageImageGallery([{ src: "one.png", alt: "截图" }], { open: "查看原图", openNamed: (name: string) => `${name}，点击查看原图`, loading: "图片加载中…", lightbox: { dialog: "原图预览", close: "关闭原图预览" } }); document.body.append(gallery);
    const button = gallery.querySelector("button"); expect(button.getAttribute("aria-label")).toBe("截图，点击查看原图"); expect(button.textContent).toBe("图片加载中…"); gallery.querySelector("img").dispatchEvent(new window.Event("load")); button.click(); expect(document.querySelector(".image-lightbox")?.getAttribute("aria-label")).toBe("原图预览"); expect(document.querySelector(".image-lightbox-close")?.getAttribute("aria-label")).toBe("关闭原图预览"); window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  });
});
