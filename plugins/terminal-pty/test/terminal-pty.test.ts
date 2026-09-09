import { tmpdir } from "node:os";
import { LocalJobService } from "@seal-harness/jobs-local";
import { sessionId } from "@seal-harness/core";
import { describe, expect, it } from "vitest";
import { PtyTerminalService, type PtyProcess } from "../src/index.js";

describe("PtyTerminalService", () => {
  it("owns terminals, streams bounded output, and publishes their Job lifecycle", async () => {
    const jobs = new LocalJobService();
    const process = new FakePty();
    const service = new PtyTerminalService(jobs, () => process, { maxOutputBytes: 5, maxTerminalsPerOwner: 1, now: () => 10 });
    const owner = sessionId("owner");
    const terminal = service.open({ ownerSession: owner, cwd: tmpdir(), command: "echo hi" });

    expect(terminal).toMatchObject({ id: "terminal-1", pid: 42, status: "running", jobId: "terminal-1" });
    expect(process.writes).toEqual(["echo hi\r"]);
    process.emitData("1234567");
    expect(service.read(terminal.id, owner).output).toBe("34567");
    expect(() => service.read(terminal.id, sessionId("other"))).toThrow("not owned");

    process.exit(0);
    expect(await jobs.wait(terminal.jobId, 1000, owner)).toMatchObject({ status: "completed", detail: "exit 0" });
    expect(service.get(terminal.id, owner)).toMatchObject({ status: "exited", exitCode: 0, finishedAt: 10 });
  });

  it("runs a command through a real platform PTY", async () => {
    const jobs = new LocalJobService();
    const service = new PtyTerminalService(jobs);
    const owner = sessionId("real-owner");
    const terminal = service.open({ ownerSession: owner, cwd: tmpdir(), command: "echo seal-pty-test && exit" });
    const completed = await jobs.wait(terminal.jobId, 10_000, owner);
    expect(completed.status).toBe("completed");
    expect(service.read(terminal.id, owner).output).toContain("seal-pty-test");
  }, 15_000);
});

class FakePty implements PtyProcess {
  readonly pid = 42;
  readonly writes: string[] = [];
  dataListener: (data: string) => void = () => {};
  exitListener: (event: { exitCode: number; signal?: number }) => void = () => {};
  write(data: string): void { this.writes.push(data); }
  kill(): void { this.exit(1); }
  onData(listener: (data: string) => void) { this.dataListener = listener; return { dispose() {} }; }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) { this.exitListener = listener; return { dispose() {} }; }
  emitData(data: string): void { this.dataListener(data); }
  exit(exitCode: number): void { this.exitListener({ exitCode }); }
}
