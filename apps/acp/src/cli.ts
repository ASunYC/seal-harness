import { resolve } from "node:path";
import { createDefaultProfile } from "@seal-harness/cli";
import { loadProfile } from "@seal-harness/host";
import type { PiAiBuiltinProvider } from "@seal-harness/provider-pi-ai";
import { AcpApprovalService, startAcpServer } from "./server.js";

export async function runAcpCli(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    const result = argv[index + 1];
    if (result === undefined || result.startsWith("--")) throw new Error(`${name} requires a value`);
    return result;
  };
  const cwd = resolve(value("--cwd") ?? process.cwd());
  const provider = value("--provider") ?? "deepseek";
  const model = value("--model") ?? "deepseek-chat";
  const configPath = value("--config");
  const approvalService = new AcpApprovalService();
  const profile = configPath === undefined
    ? createDefaultProfile({ cwd, provider: provider as PiAiBuiltinProvider, approvalService })
    : (await loadProfile({ cwd, configPath })).profile;
  const running = await startAcpServer(profile, { provider, model, approvalService });
  await running.connection.closed;
  return 0;
}

const HELP = `Seal Harness ACP\n\nUsage:\n  seal-harness acp [--cwd PATH] [--provider NAME] [--model NAME] [--config FILE]\n`;
