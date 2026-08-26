import { spawn } from "node:child_process";
import type { PiAiBuiltinProvider } from "@piharness/provider-pi-ai";
import { startWebServer } from "./server.js";

export interface WebCliEnvironment {
  readonly cwd: string;
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export async function runWebCli(argv: readonly string[], environment: WebCliEnvironment): Promise<number> {
  const args = parse(argv);
  if (args.help) {
    environment.stdout.write(HELP);
    return 0;
  }
  if (!args.allowRemote && args.host !== undefined && !isLoopback(args.host)) {
    throw new Error("Non-loopback --host requires --allow-remote; the Web UI has no user authentication");
  }
  const running = await startWebServer({
    cwd: args.cwd ?? environment.cwd,
    ...(args.host === undefined ? {} : { host: args.host }),
    ...(args.port === undefined ? {} : { port: args.port }),
    ...(args.provider === undefined ? {} : { provider: args.provider }),
  });
  environment.stdout.write(`PiHarness Web UI: ${running.url}\n`);
  if (!args.noOpen) openBrowser(running.url, environment.stderr);
  await waitForShutdown();
  await running.close();
  return 0;
}

interface WebArgs {
  readonly cwd?: string;
  readonly host?: string;
  readonly port?: number;
  readonly provider?: PiAiBuiltinProvider;
  readonly noOpen: boolean;
  readonly allowRemote: boolean;
  readonly help: boolean;
}

function parse(argv: readonly string[]): WebArgs {
  let cwd: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let provider: PiAiBuiltinProvider | undefined;
  let noOpen = false;
  let allowRemote = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--no-open") noOpen = true;
    else if (arg === "--allow-remote") allowRemote = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--cwd") cwd = take(argv, ++index, arg);
    else if (arg === "--host") host = take(argv, ++index, arg);
    else if (arg === "--port") {
      port = Number(take(argv, ++index, arg));
      if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("--port must be between 0 and 65535");
    } else if (arg === "--provider") provider = take(argv, ++index, arg) as PiAiBuiltinProvider;
    else throw new Error(`Unknown web option: ${String(arg)}`);
  }
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    ...(provider === undefined ? {} : { provider }),
    noOpen,
    allowRemote,
    help,
  };
}

function take(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolvePromise) => {
    const done = (): void => {
      process.removeListener("SIGINT", done);
      process.removeListener("SIGTERM", done);
      resolvePromise();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function openBrowser(url: string, stderr: WebCliEnvironment["stderr"]): void {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", (error) => stderr.write(`Could not open browser: ${error.message}\n`));
  child.unref();
}

const HELP = `PiHarness Web UI\n\nUsage:\n  piharness web [options]\n\nOptions:\n  --cwd <path>       Initial workspace (default: current directory)\n  --host <address>   Listen address (default: 127.0.0.1)\n  --port <number>    Listen port (default: 3080; 0 selects a free port)\n  --provider <name>  Initially selected provider (default: deepseek)\n  --no-open          Do not open the default browser\n  --allow-remote     Permit a non-loopback host (no user authentication)\n  -h, --help         Show help\n`;
