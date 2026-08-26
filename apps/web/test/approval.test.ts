import { describe, expect, it } from "vitest";
import { WebApprovalService } from "../src/approval.js";

describe("WebApprovalService", () => {
  it("publishes and resolves a pending approval", async () => {
    const service = new WebApprovalService();
    const controller = new AbortController();
    const result = service.request({
      title: "Allow shell",
      message: "Run tests",
      signal: controller.signal,
    });
    const pending = service.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ title: "Allow shell", message: "Run tests" });
    expect(service.decide(pending[0]?.id ?? "", true)).toBe(true);
    await expect(result).resolves.toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it("rejects a request when its run is aborted", async () => {
    const service = new WebApprovalService();
    const controller = new AbortController();
    const result = service.request({ title: "Approval", message: "test", signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled");
    expect(service.list()).toHaveLength(0);
  });
});
