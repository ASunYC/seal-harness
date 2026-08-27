import { runCli, type CliEnvironment } from "@seal-harness/cli";
import { runPluginCli } from "@seal-harness/plugin-manager";
import { runWebCli, type WebCliEnvironment } from "@seal-harness/web";

export interface LauncherEnvironment extends CliEnvironment {
  readonly web: WebCliEnvironment;
}

export async function runLauncher(
  argv: readonly string[],
  environment: LauncherEnvironment,
): Promise<number> {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [mode, ...rest] = normalized;
  if (mode === "web") return runWebCli(rest, environment.web);
  if (mode === "plugin") return runPluginCli(rest, {
    cwd: environment.cwd,
    env: environment.env,
    stdout: environment.io.stdout,
    stderr: environment.io.stderr,
  });
  if (mode === "headless" || mode === "run") return runCli(rest, environment);
  if (mode === "help" || mode === "--help" || mode === "-h") {
    environment.io.stdout.write(HELP);
    return 0;
  }
  return runCli(normalized, environment);
}

const HELP = `Seal Harness\n\nUsage:\n  seal-harness <prompt>             Run one headless task (legacy shorthand)\n  seal-harness run <prompt>         Run one headless task\n  seal-harness headless <prompt>    Run one headless task\n  seal-harness web [options]        Start the local Web UI\n  seal-harness plugin <command>     Install and manage optional plugins\n  seal-harness help                 Show this help\n\nUse \"seal-harness web --help\", \"seal-harness run --help\", or \"seal-harness plugin --help\" for mode options.\n`;
