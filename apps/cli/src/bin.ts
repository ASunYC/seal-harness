#!/usr/bin/env node
import { runCli } from "./cli.js";

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    io: { stdout: process.stdout, stderr: process.stderr },
  });
} catch (error) {
  process.stderr.write(`piharness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
