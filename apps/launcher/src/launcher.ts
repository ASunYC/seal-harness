import { runCli, type CliEnvironment } from "@piharness/cli";
import { runWebCli, type WebCliEnvironment } from "@piharness/web";

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
  if (mode === "headless" || mode === "run") return runCli(rest, environment);
  if (mode === "help" || mode === "--help" || mode === "-h") {
    environment.io.stdout.write(HELP);
    return 0;
  }
  return runCli(normalized, environment);
}

const HELP = `PiHarness\n\nUsage:\n  piharness <prompt>             Run one headless task (legacy shorthand)\n  piharness run <prompt>         Run one headless task\n  piharness headless <prompt>    Run one headless task\n  piharness web [options]        Start the local Web UI\n  piharness help                 Show this help\n\nUse \"piharness web --help\" or \"piharness run --help\" for mode options.\n`;
