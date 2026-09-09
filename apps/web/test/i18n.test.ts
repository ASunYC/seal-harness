import { describe, expect, it } from "vitest";

const moduleUrl = new URL("../public/i18n.js", import.meta.url).href;

describe("web translations", () => {
  it("keeps English and Simplified Chinese catalogs paired", async () => {
    const { catalogs } = await import(moduleUrl);
    expect(Object.keys(catalogs["zh-CN"]).sort()).toEqual(Object.keys(catalogs.en).sort());
    expect(Object.values(catalogs.en).every(Boolean)).toBe(true);
    expect(Object.values(catalogs["zh-CN"]).every(Boolean)).toBe(true);
  });

  it("normalizes browser locales and falls back to English keys", async () => {
    const { normalizeLocale, translator } = await import(moduleUrl);
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(translator("zh-CN")("nav.settings")).toBe("设置");
    expect(translator("zh-CN")("feedback.editNote")).toBe("编辑说明");
    expect(translator("zh-CN")("message.reasoning")).toBe("思考");
    expect(translator("zh-CN")("status.toolRunning")).toBe("工具运行中…");
    expect(translator("zh-CN")("settings.savedRestart")).toBe("已保存 · 需要重启");
    expect(translator("zh-CN")("session.rename")).toBe("重命名会话");
    expect(translator("en")("composer.steerQueuePlaceholder")).toBe("Cmd/Ctrl+Enter steers all queued messages");
    expect(translator("zh-CN")("composer.steerQueuePlaceholder")).toBe("Cmd/Ctrl+Enter 插话发送全部排队消息");
    expect(translator("en")("queue.steerFailed")).toBe("Steering failed. Try again.");
    expect(translator("zh-CN")("queue.steerFailed")).toBe("插话发送失败，请重试。");
    expect(translator("en")("queue.image")).toBe("Queued message image");
    expect(translator("zh-CN")("queue.editUnsupported")).toBe("包含非文本内容，暂不支持编辑");
    expect(translator("en")("queue.editFailed")).toBe("Edit failed: this message may have already started sending.");
    expect(translator("en")("queue.count")).toBe("{n} queued messages");
    expect(translator("en")("image.totalTooLarge")).toBe("Images exceed {size} in total; remove some and try again");
    expect(translator("zh-CN")("image.dropTitle")).toBe("图片拖动到此处即可添加");
    expect(translator("zh-CN")("image.openOriginalLabel")).toBe("{label}，点击查看原图");
    expect(translator("en")("turn.ttft")).toBe("Time to first token (TTFT)");
    expect(translator("zh-CN")("turn.ttft")).toBe("首 token 用时（TTFT）");
    expect(translator("en")("image.loadFailed")).toBe("Image failed to load; click to retry");
    expect(translator("zh-CN")("queue.removeFailed")).toBe("删除失败：这条消息可能已经开始发送。");
    expect(translator("en")("queue.save")).toBe("Save queued message");
    expect(translator("zh-CN")("queue.cancelEdit")).toBe("取消编辑");
    expect(translator("fr")("missing.key")).toBe("missing.key");
  });
});
