import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { grantArgs as landlockGrantArgs, launcherPath as resolveLandlockLauncher, probe as probeLandlockHost } from "@deepseek-ai/node-addon-landlock-run";
import { sandboxServiceToken, SandboxUnavailableError, type ConfinedArgv, type SandboxPolicy, type SandboxService, type SealHarnessEvents } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface LocalSandboxConfig { readonly runnerCommand?: readonly string[]; readonly enforcement?: "full" | "partial"; readonly denialSignatures?: readonly string[]; readonly runnerFailureSignatures?: readonly string[]; readonly platform?: NodeJS.Platform; readonly probeTimeoutMs?: number; readonly probeBwrap?: () => boolean; readonly probeLandlock?: () => "full" | "partial" | "unusable"; readonly landlockLauncher?: string; readonly seatbeltExec?: string; }

export class LocalSandboxService implements SandboxService {
  #selected: "bwrap" | "landlock" | "seatbelt" | "windows-acl" | "unavailable" | undefined;
  #landlockEnforcement: "full" | "partial" | undefined;
  constructor(readonly config: LocalSandboxConfig = {}) {}
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (argv.length === 0) throw new TypeError("sandbox argv must not be empty");
    if (this.config.runnerCommand !== undefined) {
      if (this.config.runnerCommand.length === 0) throw new TypeError("runnerCommand must not be empty");
      return { argv: [...this.config.runnerCommand, "--workspace", policy.workspaceRoot, "--mode", policy.mode, "--", ...argv], enforcement: this.config.enforcement ?? "full", denialSignatures: this.config.denialSignatures ?? ["permission denied", "access is denied", "read-only file system"], runnerFailureSignatures: this.config.runnerFailureSignatures ?? [] };
    }
    const platform = this.config.platform ?? process.platform;
    if (platform === "win32") {
      const runner = windowsRunner();
      return { argv: [process.execPath, runner, "--workspace", policy.workspaceRoot, "--temp", tmpdir(), "--mode", policy.mode, "--", ...argv], enforcement: "partial", denialSignatures: ["access is denied", "access to the path", "permission denied", "拒绝访问", "访问被拒绝"], runnerFailureSignatures: ["windows-acl-run:"] };
    }
    if (platform === "linux") {
      const selected = this.selectLinux();
      if (selected === "bwrap") return { argv: ["bwrap", ...bwrapProfile(policy), "--", ...argv], enforcement: "full", denialSignatures: ["read-only file system"], runnerFailureSignatures: ["bwrap: "] };
      if (selected === "landlock") {
        const enforcement = this.#landlockEnforcement;
        if (enforcement === undefined) throw new SandboxUnavailableError(policy.mode, "Landlock selection lost its enforcement result");
        return { argv: [this.landlockLauncher(), ...landlockProfile(policy), "--", ...argv], enforcement, denialSignatures: ["permission denied"], runnerFailureSignatures: ["landlock-run: "] };
      }
    }
    if (platform === "darwin") return { argv: [this.config.seatbeltExec ?? "sandbox-exec", ...seatbeltProfile(policy), "--", ...argv], enforcement: "full", denialSignatures: ["operation not permitted"], runnerFailureSignatures: ["sandbox-exec:"] };
    throw new SandboxUnavailableError(policy.mode, `no usable built-in backend for ${platform}`);
  }

  private selectLinux(): "bwrap" | "landlock" | "unavailable" {
    if (this.#selected === "bwrap" || this.#selected === "landlock" || this.#selected === "unavailable") return this.#selected;
    const bwrap = this.config.probeBwrap?.() ?? spawnSync("bwrap", [...bwrapProfile({ mode: "read-only", workspaceRoot: "/" }), "--", "true"], { timeout: probeTimeout(this.config), stdio: "ignore" }).status === 0;
    if (bwrap) return this.#selected = "bwrap";
    const landlock = this.config.probeLandlock?.() ?? probeLandlockHost(this.landlockLauncher(), { timeoutMs: probeTimeout(this.config) });
    if (landlock !== "unusable") this.#landlockEnforcement = landlock;
    return this.#selected = landlock === "unusable" ? "unavailable" : "landlock";
  }

  private landlockLauncher(): string { return this.config.landlockLauncher ?? resolveLandlockLauncher(); }
}

export const localSandboxPlugin = definePlugin<LocalSandboxConfig, SealHarnessEvents>({ name: "sandbox-local", provides: [sandboxServiceToken], setup(context, config) { context.provide(sandboxServiceToken, new LocalSandboxService(config)); } });

function windowsRunner(): string {
  try { return fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-sandbox-windows-acl/runner")); }
  catch {
    const require = createRequire(import.meta.url);
    try { return require.resolve("@deepseek-ai/dsh-sandbox-windows-acl/runner"); }
    catch (error) { throw new SandboxUnavailableError("workspace-write", error instanceof Error ? error.message : String(error)); }
  }
}

function probeTimeout(config: LocalSandboxConfig): number { const value = config.probeTimeoutMs ?? 5_000; if (!Number.isFinite(value) || value <= 0) throw new TypeError("probeTimeoutMs must be positive"); return value; }
function bwrapProfile(policy: SandboxPolicy): string[] { const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent"]; if (policy.mode === "workspace-write") args.push("--tmpfs", "/tmp", "--bind", policy.workspaceRoot, policy.workspaceRoot); return args; }
function landlockProfile(policy: SandboxPolicy): string[] { const readWrite = ["/dev/null", ...(policy.mode === "workspace-write" ? ["/tmp", policy.workspaceRoot] : [])]; return landlockGrantArgs({ readOnly: ["/"], readWrite }); }
function seatbeltProfile(policy: SandboxPolicy): string[] { const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; const forms = ["(version 1)", "(allow default)", "(deny file-write*)", `(allow file-write* (literal ${quote("/dev/null")}))`]; if (policy.mode === "workspace-write") forms.push(`(allow file-write* (subpath ${quote("/tmp")}) (subpath ${quote(policy.workspaceRoot)}))`); return ["-p", forms.join(" ")]; }
