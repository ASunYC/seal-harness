import { describe, expect, it } from "vitest";
import { isFolderOpenPath, openFailureMessage } from "../public/file-open.js";

describe("file-open presentation", () => {
  it("uses the folder copy only for the workspace-root gesture", () => {
    expect(isFolderOpenPath(".")).toBe(true);
    expect(isFolderOpenPath("docs")).toBe(false);
  });

  it("preserves host errors and falls back for an empty refusal", () => {
    expect(openFailureMessage(new Error("No associated application"), "fallback")).toBe("No associated application");
    expect(openFailureMessage(new Error(""), "fallback")).toBe("fallback");
    expect(openFailureMessage("denied", "fallback")).toBe("denied");
  });
});
