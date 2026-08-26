#!/usr/bin/env node
import { runWebCli } from "./cli.js";

try {
  process.exitCode = await runWebCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (error) {
  process.stderr.write(`piharness-web: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
