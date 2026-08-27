import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runLauncher } from "../src/launcher.js";

describe("Seal Harness launcher", () => {
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
    expect(stdout).toContain("seal-harness web");
    expect(stdout).toContain("seal-harness run");
    expect(stdout).toContain("seal-harness plugin");
  });

  it("routes plugin help without touching a profile", async () => {
    let stdout = "";
    const code = await runLauncher(["plugin", "--help"], {
      cwd: process.cwd(),
      env: {},
      stdin: new PassThrough(),
      io: { stdout: { write(value) { stdout += value; } }, stderr: { write() {} } },
      web: { cwd: process.cwd(), stdout: { write() {} }, stderr: { write() {} } },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("plugin manager");
    expect(stdout).toContain("add <package-spec>");
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
    expect(stdout).toContain("seal-harness web");
  });
});
