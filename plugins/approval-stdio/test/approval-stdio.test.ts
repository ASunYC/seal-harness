import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { StdioApprovalService } from "../src/index.js";

const request = {
  title: "Dangerous tool",
  message: "Run command",
  signal: new AbortController().signal,
};

describe("StdioApprovalService", () => {
  it("supports explicit allow and deny modes", async () => {
    await expect(new StdioApprovalService("allow").request(request)).resolves.toBe(true);
    await expect(new StdioApprovalService("deny").request(request)).resolves.toBe(false);
  });

  it("fails closed when ask mode has no TTY", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    await expect(new StdioApprovalService("ask", input, output).request(request)).resolves.toBe(false);
  });
});
