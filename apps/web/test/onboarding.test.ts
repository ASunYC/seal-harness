import { describe, expect, it } from "vitest";
import { credentialStatusModel } from "../public/onboarding.js";

describe("credential onboarding", () => {
  it("projects configured, inherited, and clearable credential controls", () => {
    expect(credentialStatusModel(null)).toEqual({ label: "unavailable", writable: true, clearable: false });
    expect(credentialStatusModel({ configured: false, writable: true })).toEqual({ label: "missing", writable: true, clearable: false });
    expect(credentialStatusModel({ configured: true, source: "file", writable: true })).toEqual({ label: "configured", writable: true, clearable: true });
    expect(credentialStatusModel({ configured: true, source: "env", writable: false })).toEqual({ label: "environment", writable: false, clearable: false });
  });
});
