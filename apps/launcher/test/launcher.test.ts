import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runLauncher } from "../src/launcher.js";

describe("PiHarness launcher", () => {
  it("shows product modes without starting a profile", async () => {
    let stdout = "";
    const code = await runLauncher(["help"], {
      cwd: process.cwd(),
      env: {},
      stdin: new PassThrough(),
      io: { stdout: { write(value) { stdout += value; } }, stderr: { write() {} } },
      web: { cwd: process.cwd(), stdout: { write(value) { stdout += value; } }, stderr: { write() {} } },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("piharness web");
    expect(stdout).toContain("piharness run");
  });

  it("accepts the pnpm argument separator", async () => {
    let stdout = "";
    const code = await runLauncher(["--", "help"], {
      cwd: process.cwd(),
      env: {},
      stdin: new PassThrough(),
      io: { stdout: { write(value) { stdout += value; } }, stderr: { write() {} } },
      web: { cwd: process.cwd(), stdout: { write(value) { stdout += value; } }, stderr: { write() {} } },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("piharness web");
  });
});
