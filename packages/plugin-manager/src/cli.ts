import { PluginProfileManager, type PluginManagerEnvironment } from "./manager.js";

export interface PluginCliEnvironment extends PluginManagerEnvironment {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export async function runPluginCli(
  argv: readonly string[],
  environment: PluginCliEnvironment,
): Promise<number> {
  const args = parse(argv);
  if (args.help || args.command === undefined) {
    environment.stdout.write(HELP);
    return args.help ? 0 : 1;
  }
  const manager = new PluginProfileManager({
    ...environment,
    ...(args.home === undefined ? {} : { home: args.home }),
    profile: args.profile,
  });
  switch (args.command) {
    case "add": {
      if (args.values.length !== 1) throw new Error("plugin add requires exactly one package spec");
      const entries = await manager.add(args.values[0] ?? "");
      for (const entry of entries) environment.stdout.write(`added ${entry.name}@${entry.version}\n`);
      return 0;
    }
    case "remove": {
      const removed = await manager.remove(args.values);
      for (const name of removed) environment.stdout.write(`removed ${name}\n`);
      return 0;
    }
    case "list": {
      for (const entry of await manager.list()) {
        environment.stdout.write(`${entry.enabled ? "enabled" : "disabled"}\t${entry.name}@${entry.version}\t${entry.spec}\n`);
      }
      return 0;
    }
    case "doctor": {
      let failed = false;
      for (const entry of await manager.doctor()) {
        environment.stdout.write(`${entry.status}\t${entry.name}@${entry.version}`
          + `${entry.missingHostServices.length === 0 ? "" : `\thost:${entry.missingHostServices.join(",")}`}`
          + `${entry.missingClientServices.length === 0 ? "" : `\tclient:${entry.missingClientServices.join(",")}`}`
          + `${entry.error === undefined ? "" : `\t${entry.error}`}\n`);
        if (entry.status === "invalid") failed = true;
      }
      return failed ? 1 : 0;
    }
    case "enable":
    case "disable": {
      if (args.values.length !== 1) throw new Error(`plugin ${args.command} requires exactly one package name`);
      await manager.setEnabled(args.values[0] ?? "", args.command === "enable");
      environment.stdout.write(`${args.command}d ${args.values[0]}\n`);
      return 0;
    }
  }
}

interface ParsedArgs {
  readonly command?: "add" | "remove" | "list" | "doctor" | "enable" | "disable";
  readonly values: string[];
  readonly profile: string;
  readonly home?: string;
  readonly help: boolean;
}

function parse(argv: readonly string[]): ParsedArgs {
  let command: ParsedArgs["command"];
  const values: string[] = [];
  let profile = "web";
  let home: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || arg === "--") continue;
    if (arg === "--profile") profile = take(argv, ++index, arg);
    else if (arg === "--home") home = take(argv, ++index, arg);
    else if (arg === "--help" || arg === "-h") help = true;
    else if (command === undefined && isCommand(arg)) command = arg;
    else if (arg.startsWith("-")) throw new Error(`Unknown plugin option: ${arg}`);
    else values.push(arg);
  }
  return { ...(command === undefined ? {} : { command }), values, profile, ...(home === undefined ? {} : { home }), help };
}

function isCommand(value: string): value is NonNullable<ParsedArgs["command"]> {
  return value === "add" || value === "remove" || value === "list" || value === "doctor" || value === "enable" || value === "disable";
}

function take(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

const HELP = `Seal Harness plugin manager\n\nUsage:\n  seal-harness plugin [--profile web] add <package-spec>\n  seal-harness plugin [--profile web] remove <package-name...>\n  seal-harness plugin [--profile web] list\n  seal-harness plugin [--profile web] doctor\n  seal-harness plugin [--profile web] enable <package-name>\n  seal-harness plugin [--profile web] disable <package-name>\n\nOptions:\n  --profile <name>  Isolated plugin profile (default: web)\n  --home <path>     Seal Harness home (default: ~/.seal-harness)\n`;
