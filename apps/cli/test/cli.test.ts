import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("CLI", () => {
  it("prints help without starting a profile", async () => {
    let stdout = "";
    const code = await runCli(["--help"], {
      cwd: process.cwd(),
      env: {},
      stdin: new PassThrough(),
      io: {
        stdout: { write(value) { stdout += value; } },
        stderr: { write() {} },
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--config");
  });
});
