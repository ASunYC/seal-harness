import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/composer-primary.js")).href;

describe("composer primary action", () => {
  it("uses the primary button as stop only for an empty main-session draft", async () => {
    const { composerPrimaryModel } = await import(moduleUrl);
    expect(composerPrimaryModel({ running: false, draft: "", attachmentCount: 0 })).toEqual({ action: "submit", label: "run", showSecondaryStop: false });
    expect(composerPrimaryModel({ running: true, draft: "", attachmentCount: 0 })).toEqual({ action: "stop", label: "stop", showSecondaryStop: false });
    expect(composerPrimaryModel({ running: true, draft: "next", attachmentCount: 0 })).toEqual({ action: "submit", label: "send", showSecondaryStop: true });
    expect(composerPrimaryModel({ running: true, draft: "", attachmentCount: 1 })).toEqual({ action: "submit", label: "send", showSecondaryStop: true });
    expect(composerPrimaryModel({ running: true, draft: "", attachmentCount: 0, continuableSubagent: true })).toEqual({ action: "submit", label: "send", showSecondaryStop: true });
  });
});
