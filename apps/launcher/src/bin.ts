#!/usr/bin/env node
import { runLauncher } from "./launcher.js";

try {
  process.exitCode = await runLauncher(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    io: { stdout: process.stdout, stderr: process.stderr },
    web: { cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr },
  });
} catch (error) {
  process.stderr.write(`seal-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
