#!/usr/bin/env node
import { resolve } from "node:path";
import { createDefaultProfile } from "@seal-harness/cli";
import { loadProfile } from "@seal-harness/host";
import type { PiAiBuiltinProvider } from "@seal-harness/provider-pi-ai";
import { runRpcServer } from "./server.js";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const providerIndex = args.indexOf("--provider");
const cwdIndex = args.indexOf("--cwd");
const cwd = resolve(cwdIndex < 0 ? process.cwd() : args[cwdIndex + 1] ?? ".");
const configPath = configIndex < 0 ? undefined : args[configIndex + 1];
if (configIndex >= 0 && configPath === undefined) throw new Error("--config requires a value");
const profile = configPath === undefined
  ? createDefaultProfile({
      cwd,
      provider: (providerIndex < 0 ? "deepseek" : args[providerIndex + 1]) as PiAiBuiltinProvider,
      approvalMode: "deny",
    })
  : (await loadProfile({ cwd, configPath })).profile;

await runRpcServer(profile, { input: process.stdin, output: process.stdout });
