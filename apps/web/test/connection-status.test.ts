import { describe, expect, it } from "vitest";
import { nextConnectionFeedback } from "../public/connection-status.js";

describe("connection feedback", () => {
  it("distinguishes initial connection, retry, offline, and recovery", () => {
    expect(nextConnectionFeedback(null, "open")).toBeNull();
    expect(nextConnectionFeedback(null, "connecting")).toBe("connecting");
    expect(nextConnectionFeedback("connecting", "open")).toBe("recovered");
    expect(nextConnectionFeedback("recovered", "closed", false)).toBe("disconnected");
  });
});
