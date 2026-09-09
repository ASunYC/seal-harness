// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clearInlineError, showInlineError } from "../public/inline-error.js";

afterEach(() => { document.body.replaceChildren(); });

describe("inline action errors", () => {
  it("creates an alert at the interaction site and updates it in place", () => {
    const root = document.createElement("div"); document.body.append(root);
    const first = showInlineError(root, "row-error", "Failed"); const second = showInlineError(root, "row-error", "Conflict");
    expect(second).toBe(first); expect(root.querySelectorAll(".row-error")).toHaveLength(1); expect(second.getAttribute("role")).toBe("alert"); expect(second.textContent).toBe("Conflict");
  });

  it("clears only the requested local error", () => {
    const root = document.createElement("div"); document.body.append(root); showInlineError(root, "row-error", "Failed"); showInlineError(root, "note-error", "Save failed");
    clearInlineError(root, "row-error"); expect(root.querySelector(".row-error")).toBeNull(); expect(root.querySelector(".note-error")).not.toBeNull();
  });
});
