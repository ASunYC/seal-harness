import { describe, expect, it, vi } from "vitest";
import { NoopTelemetryService } from "../src/index.js";

describe("NoopTelemetryService", () => {
  it("does not perform network access", async () => {
    const originalFetch = globalThis.fetch;
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    try {
      const telemetry = new NoopTelemetryService();
      telemetry.record({ name: "test", timestamp: new Date(0).toISOString() });
      await telemetry.flush();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
