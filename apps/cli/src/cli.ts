import { resolve } from "node:path";
import { agentServiceToken, modelServiceToken, sessionId, type SessionId } from "@piharness/core";
import { loadProfile, startProfile } from "@piharness/host";
import type { PiAiBuiltinProvider } from "@piharness/provider-pi-ai";
import { createDefaultProfile } from "./default-profile.js";
import { promptRequest, runHeadless, type HeadlessIo } from "./run-headless.js";

const PROVIDERS = new Set<PiAiBuiltinProvider>([
  "anthropic", "deepseek", "google", "groq", "mistral", "openai", "openrouter", "xai",
]);

export interface CliEnvironment {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: NodeJS.ReadableStream;
  readonly io: HeadlessIo;
}

export async function runCli(
  argv: readonly string[],
  environment: CliEnvironment,
): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    environment.io.stdout.write(HELP);
    return 0;
  }

  const cwd = resolve(environment.cwd, args.cwd ?? ".");
  const provider = args.provider ?? environment.env.PIHARNESS_PROVIDER ?? "deepseek";
  const profile = args.config === undefined
    ? createDefaultProfile({
        cwd,
        provider: parseProvider(provider),
        approvalMode: args.yes ? "allow" : args.denyApprovals ? "deny" : "ask",
        enableShell: !args.noShell,
        ...(args.sessions === undefined ? {} : { sessionRoot: resolve(cwd, args.sessions) }),
      })
    : (await loadProfile({ cwd, configPath: args.config })).profile;

  const kernel = await startProfile(profile);
  const abortController = new AbortController();
  const onInterrupt = (): void => abortController.abort(new Error("Interrupted"));
  process.once("SIGINT", onInterrupt);
  try {
    if (args.listModels) {
      const models = await kernel.use(modelServiceToken).list();
      for (const model of models) {
        environment.io.stdout.write(`${model.provider}/${model.model}\n`);
      }
      return 0;
    }

    const prompt = args.prompt.length > 0
      ? args.prompt.join(" ")
      : await readStandardInput(environment.stdin);
    if (prompt.trim().length === 0) throw new Error("Prompt is required");
    let activeSessionId: SessionId | undefined = args.session === undefined
      ? undefined
      : sessionId(args.session);
    if (args.fork !== undefined) {
      const forked = await kernel.use(agentServiceToken).fork({
        sourceSessionId: sessionId(args.fork),
        ...(args.forkTarget === undefined
          ? {}
          : { targetSessionId: sessionId(args.forkTarget) }),
        ...(args.forkVersion === undefined ? {} : { throughVersion: args.forkVersion }),
      });
      activeSessionId = forked.id;
      environment.io.stderr.write(`forked session: ${forked.id}\n`);
    }
    const model = args.model
      ?? environment.env.PIHARNESS_MODEL
      ?? await firstModel(kernel.use(modelServiceToken), provider);
    const result = await runHeadless(
      kernel,
      promptRequest(cwd, provider, model, prompt, {
        ...(activeSessionId === undefined ? {} : { sessionId: activeSessionId }),
        ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
        signal: abortController.signal,
      }),
      environment.io,
    );
    environment.io.stderr.write(`session: ${result.sessionId}\n`);
    if (result.errorMessage !== undefined) {
      environment.io.stderr.write(`error: ${result.errorMessage}\n`);
      return 1;
    }
    return result.stopReason === "error" ? 1 : 0;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    await kernel.stop();
  }
}

interface ParsedArgs {
  prompt: string[];
  provider?: string;
  model?: string;
  cwd?: string;
  session?: string;
  fork?: string;
  forkTarget?: string;
  forkVersion?: number;
  sessions?: string;
  config?: string;
  reasoning?: "off" | "low" | "medium" | "high" | "max";
  yes: boolean;
  denyApprovals: boolean;
  noShell: boolean;
  listModels: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    prompt: [],
    yes: false,
    denyApprovals: false,
    noShell: false,
    listModels: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("-")) {
      result.prompt.push(arg);
      continue;
    }
    if (arg === "--yes") result.yes = true;
    else if (arg === "--deny-approvals") result.denyApprovals = true;
    else if (arg === "--no-shell") result.noShell = true;
    else if (arg === "--list-models") result.listModels = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--provider") result.provider = takeValue(argv, ++index, arg);
    else if (arg === "--model") result.model = takeValue(argv, ++index, arg);
    else if (arg === "--cwd") result.cwd = takeValue(argv, ++index, arg);
    else if (arg === "--session") result.session = takeValue(argv, ++index, arg);
    else if (arg === "--fork") result.fork = takeValue(argv, ++index, arg);
    else if (arg === "--fork-target") result.forkTarget = takeValue(argv, ++index, arg);
    else if (arg === "--fork-version") {
      const value = Number(takeValue(argv, ++index, arg));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--fork-version must be a positive integer");
      }
      result.forkVersion = value;
    }
    else if (arg === "--sessions") result.sessions = takeValue(argv, ++index, arg);
    else if (arg === "--config") result.config = takeValue(argv, ++index, arg);
    else if (arg === "--reasoning") {
      const value = takeValue(argv, ++index, arg);
      if (!(["off", "low", "medium", "high", "max"] as const).includes(value as any)) {
        throw new Error(`Invalid reasoning level: ${value}`);
      }
      result.reasoning = value as NonNullable<ParsedArgs["reasoning"]>;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (result.yes && result.denyApprovals) {
    throw new Error("--yes and --deny-approvals cannot be used together");
  }
  if (result.session !== undefined && result.fork !== undefined) {
    throw new Error("--session and --fork cannot be used together");
  }
  if ((result.forkTarget !== undefined || result.forkVersion !== undefined) && result.fork === undefined) {
    throw new Error("--fork-target and --fork-version require --fork");
  }
  return result;
}

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseProvider(value: string): PiAiBuiltinProvider {
  if (!PROVIDERS.has(value as PiAiBuiltinProvider)) {
    throw new Error(`Unsupported built-in provider: ${value}. Use --config for a custom provider.`);
  }
  return value as PiAiBuiltinProvider;
}

async function firstModel(
  service: import("@piharness/core").ModelService,
  provider: string,
): Promise<string> {
  const model = (await service.list()).find((candidate) => candidate.provider === provider);
  if (model === undefined) throw new Error(`Provider has no models: ${provider}`);
  return model.model;
}

async function readStandardInput(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const HELP = `PiHarness\n\nUsage:\n  piharness [options] <prompt>\n\nOptions:\n  --provider <name>       Built-in Pi AI provider (default: deepseek)\n  --model <id>            Model id (default: first provider model)\n  --reasoning <level>     off|low|medium|high|max\n  --cwd <path>            Workspace directory\n  --session <id>          Continue an existing session\n  --fork <id>             Fork an existing session before prompting\n  --fork-target <id>      Explicit target id for --fork\n  --fork-version <n>      Fork through a selected event version\n  --sessions <path>       Session storage root\n  --config <path>         Native ESM Profile\n  --yes                   Auto-approve ask decisions\n  --deny-approvals        Reject all ask decisions\n  --no-shell              Do not register the shell tool\n  --list-models           List configured models\n  -h, --help              Show help\n`;
