import { spawn } from "node:child_process";
import { homedir } from "node:os";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export interface PluginManagerEnvironment {
  readonly home?: string;
  readonly profile?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly runPackageManager?: PackageManagerRunner;
}

export type PackageManagerRunner = (
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
) => Promise<void>;

export interface InstalledPlugin {
  readonly name: string;
  readonly version: string;
  readonly spec: string;
  readonly root: string;
  readonly hostEntry: string;
  readonly clientEntry?: string;
  readonly clientInject: readonly string[];
  readonly wiringId?: string;
  readonly enabled: boolean;
  readonly skin?: PluginSkin;
}

export interface PluginSkin {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly tagline?: string;
  readonly package: string;
  readonly bodyAttr: string;
  readonly order: number;
}

export interface PluginDoctorEntry extends InstalledPlugin {
  readonly hostInject: readonly string[];
  readonly missingHostServices: readonly string[];
  readonly missingClientServices: readonly string[];
  readonly status: "ready" | "adapter-required" | "invalid";
  readonly error?: string;
}

interface ProfileManifest {
  name: string;
  private: true;
  type: "module";
  dependencies: Record<string, string>;
}

interface PluginState {
  readonly specs: Record<string, string>;
}

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
  readonly dsh?: {
    readonly bundle?: { readonly patch?: unknown };
    readonly client?: { readonly inject?: unknown; readonly platform?: unknown };
  };
}

const PROFILE_NAME = /^[a-zA-Z0-9._-]+$/;
const SUPPORTED_HOST_SERVICES = new Set(["tools", "webServer"]);
const SUPPORTED_CLIENT_SERVICES = new Set<string>();

export class PluginProfileManager {
  readonly home: string;
  readonly profile: string;
  readonly profileRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runPackageManager: PackageManagerRunner;

  constructor(options: PluginManagerEnvironment = {}) {
    const env = options.env ?? process.env;
    this.home = resolve(options.home ?? env.SEAL_HARNESS_HOME ?? join(homedir(), ".seal-harness"));
    this.profile = options.profile ?? "web";
    if (!PROFILE_NAME.test(this.profile)) throw new TypeError(`Invalid plugin profile: ${this.profile}`);
    this.profileRoot = join(this.home, "profiles", this.profile);
    this.env = env;
    this.runPackageManager = options.runPackageManager ?? defaultPackageManagerRunner;
  }

  async ensure(): Promise<void> {
    await mkdir(this.profileRoot, { recursive: true });
    const manifestPath = this.manifestPath();
    if (!(await exists(manifestPath))) {
      await writeJsonAtomic(manifestPath, {
        name: `seal-harness-profile-${this.profile}`,
        private: true,
        type: "module",
        dependencies: {},
      } satisfies ProfileManifest);
    }
    const patchPath = this.patchPath();
    if (!(await exists(patchPath))) await writeFile(patchPath, "[]\n", "utf8");
    const workspacePath = join(this.profileRoot, "pnpm-workspace.yaml");
    if (!(await exists(workspacePath))) {
      await writeFile(workspacePath, "packages:\n  - .\n", "utf8");
    }
  }

  async add(spec: string): Promise<readonly InstalledPlugin[]> {
    const normalized = spec.trim();
    if (normalized.length === 0) throw new TypeError("plugin add requires a package spec");
    await this.ensure();
    const before = await this.readManifest();
    const installSpec = await this.materializeSpec(normalized);
    await this.runPackageManager(
      ["add", "--save-prod", "--save-exact", "--ignore-scripts", installSpec],
      { cwd: this.profileRoot, env: this.env },
    );
    const after = await this.readManifest();
    const changed = Object.keys(after.dependencies).filter((name) =>
      before.dependencies[name] !== after.dependencies[name],
    );
    if (changed.length > 0) {
      const state = await this.readState();
      for (const name of changed) state.specs[name] = normalized;
      await writeJsonAtomic(this.statePath(), state);
    }
    const installed = await this.list();
    return changed.length === 0
      ? installed.filter((entry) => entry.spec === normalized || entry.name === normalized)
      : installed.filter((entry) => changed.includes(entry.name));
  }

  async remove(names: readonly string[]): Promise<readonly string[]> {
    const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (normalized.length === 0) throw new TypeError("plugin remove requires at least one package name");
    await this.ensure();
    const manifest = await this.readManifest();
    const missing = normalized.filter((name) => manifest.dependencies[name] === undefined);
    if (missing.length > 0) throw new Error(`Plugin is not installed: ${missing.join(", ")}`);
    await this.runPackageManager(["remove", ...normalized], {
      cwd: this.profileRoot,
      env: this.env,
    });
    const state = await this.readState();
    for (const name of normalized) delete state.specs[name];
    await writeJsonAtomic(this.statePath(), state);
    return normalized;
  }

  async list(): Promise<readonly InstalledPlugin[]> {
    await this.ensure();
    const manifest = await this.readManifest();
    const state = await this.readState();
    const disabled = await readDisabledIds(this.patchPath());
    const entries: InstalledPlugin[] = [];
    for (const [name, manifestSpec] of Object.entries(manifest.dependencies)) {
      const spec = state.specs[name] ?? manifestSpec;
      try {
        const value = await this.inspect(name, spec, disabled);
        entries.push(value);
      } catch {
        // `doctor()` reports broken packages; list remains useful for removals.
        entries.push({
          name,
          version: "unknown",
          spec,
          root: packageRootFallback(this.profileRoot, name),
          hostEntry: "",
          clientInject: [],
          enabled: false,
        });
      }
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  async doctor(): Promise<readonly PluginDoctorEntry[]> {
    await this.ensure();
    const manifest = await this.readManifest();
    const state = await this.readState();
    const disabled = await readDisabledIds(this.patchPath());
    const entries: PluginDoctorEntry[] = [];
    for (const [name, manifestSpec] of Object.entries(manifest.dependencies)) {
      const spec = state.specs[name] ?? manifestSpec;
      try {
        const installed = await this.inspect(name, spec, disabled);
        const module = await import(pathToFileURL(installed.hostEntry).href);
        const inject = stringArray(module.inject ?? module.default?.inject);
        const missingHostServices = inject.filter((service) => !SUPPORTED_HOST_SERVICES.has(service));
        const missingClientServices = installed.clientInject.filter(
          (service) => !SUPPORTED_CLIENT_SERVICES.has(service),
        );
        entries.push({
          ...installed,
          hostInject: inject,
          missingHostServices,
          missingClientServices,
          status: missingHostServices.length === 0 && missingClientServices.length === 0
            ? "ready"
            : "adapter-required",
        });
      } catch (error) {
        entries.push({
          name,
          version: "unknown",
          spec,
          root: packageRootFallback(this.profileRoot, name),
          hostEntry: "",
          clientInject: [],
          enabled: false,
          hostInject: [],
          missingHostServices: [],
          missingClientServices: [],
          status: "invalid",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return entries;
  }

  async loadHostPlugins(): Promise<Array<{ plugin: unknown; config: undefined; enabled: boolean }>> {
    const installed = await this.list();
    const values: Array<{ plugin: unknown; config: undefined; enabled: boolean }> = [];
    for (const entry of installed) {
      if (entry.hostEntry.length === 0) continue;
      values.push({
        plugin: await import(pathToFileURL(entry.hostEntry).href),
        config: undefined,
        enabled: entry.enabled,
      });
    }
    return values;
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const entry = (await this.list()).find((candidate) => candidate.name === name);
    if (entry === undefined) throw new Error(`Plugin is not installed: ${name}`);
    if (entry.wiringId === undefined) throw new Error(`Plugin has no DSH wiring id: ${name}`);
    await setPatchDisabled(this.patchPath(), entry.wiringId, !enabled);
  }

  dshEnvironment(): Record<string, string> {
    return { DSH_HOME: this.home, DSH_PROFILE: this.profile };
  }

  private async inspect(
    name: string,
    spec: string,
    disabled: ReadonlySet<string>,
  ): Promise<InstalledPlugin> {
    const packageJson = resolvePackageJson(this.profileRoot, name);
    const root = dirname(packageJson);
    const manifest = JSON.parse(await readFile(packageJson, "utf8")) as PackageManifest;
    if (manifest.name !== name) throw new Error(`Plugin package name mismatch: expected ${name}`);
    const hostEntry = resolveEntry(root, manifest.main, manifest.exports, ".");
    const clientEntry = manifest.dsh?.client === undefined
      ? undefined
      : resolveEntry(root, undefined, manifest.exports, "./client");
    const patch = typeof manifest.dsh?.bundle?.patch === "string"
      ? join(root, manifest.dsh.bundle.patch)
      : undefined;
    const wiringId = patch === undefined || !(await exists(patch))
      ? undefined
      : parseWiringId(await readFile(patch, "utf8"));
    const skin = await readSkin(root, name);
    return {
      name,
      version: typeof manifest.version === "string" ? manifest.version : "unknown",
      spec,
      root,
      hostEntry,
      ...(clientEntry === undefined ? {} : { clientEntry }),
      clientInject: stringArray(manifest.dsh?.client?.inject),
      ...(wiringId === undefined ? {} : { wiringId }),
      enabled: wiringId === undefined || !disabled.has(wiringId),
      ...(skin === undefined ? {} : { skin }),
    };
  }

  private async readManifest(): Promise<ProfileManifest> {
    const parsed = JSON.parse(await readFile(this.manifestPath(), "utf8")) as Partial<ProfileManifest>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : `seal-harness-profile-${this.profile}`,
      private: true,
      type: "module",
      dependencies: parsed.dependencies ?? {},
    };
  }

  private async readState(): Promise<{ specs: Record<string, string> }> {
    if (!(await exists(this.statePath()))) return { specs: {} };
    try {
      const parsed = JSON.parse(await readFile(this.statePath(), "utf8")) as Partial<PluginState>;
      return { specs: parsed.specs ?? {} };
    } catch {
      return { specs: {} };
    }
  }

  private async materializeSpec(spec: string): Promise<string> {
    const github = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#path:\/?([^&]+)$/.exec(spec);
    if (github === null) return spec;
    const owner = github[1] ?? "";
    const repository = github[2] ?? "";
    const subdirectory = (github[3] ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (subdirectory.length === 0 || subdirectory.split("/").some((part) => part === ".." || part === "." || part === "")) {
      throw new TypeError(`Invalid GitHub plugin subdirectory: ${subdirectory}`);
    }
    const checkout = join(this.profileRoot, ".sources", "github", owner, repository);
    if (!(await exists(join(checkout, ".git")))) {
      await mkdir(dirname(checkout), { recursive: true });
      try {
        await runGit(["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", `https://github.com/${owner}/${repository}.git`, checkout], this.profileRoot, this.env);
        await runGit(["-C", checkout, "sparse-checkout", "init", "--no-cone"], this.profileRoot, this.env);
      } catch (error) {
        await rm(checkout, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }
    const sparseStatePath = join(checkout, ".seal-harness-sparse.json");
    const sparseDirectories = await readSparseDirectories(sparseStatePath);
    sparseDirectories.add(subdirectory);
    const patterns = [...sparseDirectories].flatMap((directory) => [
      `/${directory}/package.json`,
      `/${directory}/lib/`,
      `/${directory}/cordis.patch.yml`,
      `/${directory}/skin.json`,
      `/${directory}/skin.build.json`,
      `/${directory}/LICENSE`,
      `/${directory}/NOTICE`,
    ]);
    await runGit(
      ["-C", checkout, "sparse-checkout", "set", "--no-cone", "--stdin"],
      this.profileRoot,
      this.env,
      `${patterns.join("\n")}\n`,
    );
    await runGit(["-C", checkout, "checkout"], this.profileRoot, this.env);
    await writeJsonAtomic(sparseStatePath, { directories: [...sparseDirectories].sort() });
    const packageRoot = join(checkout, ...subdirectory.split("/"));
    if (!(await exists(join(packageRoot, "package.json")))) {
      throw new Error(`GitHub plugin path has no package.json: ${spec}`);
    }
    return packageRoot;
  }

  private manifestPath(): string { return join(this.profileRoot, "package.json"); }
  private patchPath(): string { return join(this.profileRoot, "cordis.patch.yml"); }
  private statePath(): string { return join(this.profileRoot, "seal-harness.plugins.json"); }
}

async function runGit(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  input?: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
      stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    });
    if (input !== undefined) child.stdin?.end(input);
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`git ${args.join(" ")} failed with exit code ${String(code)}`)));
  });
}

async function readSparseDirectories(path: string): Promise<Set<string>> {
  if (!(await exists(path))) return new Set();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { directories?: unknown };
    return new Set(stringArray(parsed.directories));
  } catch {
    return new Set();
  }
}

async function defaultPackageManagerRunner(
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
): Promise<void> {
  const invocation = await resolvePnpmInvocation(options.env);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(invocation.command, [...invocation.prefix, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", (error) => reject(new Error(`Could not start pnpm; install pnpm >= 9 or set SEAL_HARNESS_PNPM`, { cause: error })));
    child.once("close", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`pnpm ${args.join(" ")} failed with exit code ${String(code)}`)));
  });
}

interface PnpmInvocation {
  readonly command: string;
  readonly prefix: readonly string[];
}

async function resolvePnpmInvocation(
  env: Readonly<Record<string, string | undefined>>,
): Promise<PnpmInvocation> {
  const explicit = env.SEAL_HARNESS_PNPM;
  if (explicit !== undefined) return invocationFor(explicit);
  const npmExecPath = env.npm_execpath;
  if (npmExecPath?.toLowerCase().includes("pnpm")) {
    return { command: process.execPath, prefix: [npmExecPath] };
  }
  if (process.platform !== "win32") return { command: "pnpm", prefix: [] };
  for (const directory of (env.Path ?? env.PATH ?? process.env.Path ?? "").split(delimiter)) {
    if (directory.trim().length === 0) continue;
    const candidate = join(directory, "pnpm.cmd");
    if (await exists(candidate)) return invocationFor(candidate);
  }
  throw new Error("Could not find pnpm; install pnpm >= 9 or set SEAL_HARNESS_PNPM");
}

async function invocationFor(command: string): Promise<PnpmInvocation> {
  const lower = command.toLowerCase();
  if (!lower.endsWith(".cmd")) {
    return /\.(?:cjs|mjs|js)$/.test(lower)
      ? { command: process.execPath, prefix: [command] }
      : { command, prefix: [] };
  }
  const source = await readFile(command, "utf8");
  const matches = [...source.matchAll(/"([^"]*pnpm\.(?:cjs|mjs|js))"/gi)];
  const raw = matches.at(-1)?.[1];
  if (raw === undefined) throw new Error(`Could not resolve pnpm JavaScript entry from ${command}`);
  const entry = resolve(raw.replaceAll(/%~dp0/gi, `${dirname(command)}${sep}`));
  if (!(await exists(entry))) throw new Error(`pnpm JavaScript entry does not exist: ${entry}`);
  return { command: process.execPath, prefix: [entry] };
}

function resolvePackageJson(profileRoot: string, name: string): string {
  const fallback = join(packageRootFallback(profileRoot, name), "package.json");
  try {
    return createRequire(join(profileRoot, "package.json")).resolve(`${name}/package.json`);
  } catch {
    return fallback;
  }
}

function packageRootFallback(profileRoot: string, name: string): string {
  return join(profileRoot, "node_modules", ...name.split("/"));
}

function resolveEntry(root: string, main: unknown, exportsValue: unknown, subpath: "." | "./client"): string {
  const target = exportTarget(exportsValue, subpath)
    ?? (subpath === "." && typeof main === "string" ? main : undefined);
  if (target === undefined) throw new Error(`Plugin does not export ${subpath}`);
  const resolved = resolve(root, target);
  if (!isWithin(root, resolved)) throw new Error(`Plugin export escapes package root: ${target}`);
  return resolved;
}

function exportTarget(exportsValue: unknown, subpath: "." | "./client"): string | undefined {
  if (subpath === "." && typeof exportsValue === "string") return exportsValue;
  if (typeof exportsValue !== "object" || exportsValue === null || Array.isArray(exportsValue)) return undefined;
  const value = (exportsValue as Record<string, unknown>)[subpath];
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const conditions = value as Record<string, unknown>;
  for (const key of ["import", "default", "node"]) {
    if (typeof conditions[key] === "string") return conditions[key] as string;
  }
  return undefined;
}

async function readSkin(root: string, packageName: string): Promise<PluginSkin | undefined> {
  const path = join(root, "skin.json");
  if (!(await exists(path))) return undefined;
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (
    typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.bodyAttr !== "string"
    || value.package !== packageName
  ) return undefined;
  return {
    id: value.id,
    name: value.name,
    ...(typeof value.nameEn === "string" ? { nameEn: value.nameEn } : {}),
    ...(typeof value.tagline === "string" ? { tagline: value.tagline } : {}),
    package: packageName,
    bodyAttr: value.bodyAttr,
    order: typeof value.order === "number" && Number.isFinite(value.order) ? value.order : 100,
  };
}

function parseWiringId(source: string): string | undefined {
  const match = /^\s*-\s+id:\s*['"]?([^'"#\s]+)['"]?\s*$/m.exec(source);
  return match?.[1];
}

async function readDisabledIds(path: string): Promise<ReadonlySet<string>> {
  if (!(await exists(path))) return new Set();
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const disabled = new Set<string>();
  let id: string | undefined;
  for (const line of lines) {
    const row = /^\s*-\s+id:\s*['"]?([^'"#\s]+)['"]?/.exec(line);
    if (row !== null) { id = row[1]; continue; }
    if (id !== undefined && /^\s+disabled:\s*true\s*(?:#.*)?$/.test(line)) disabled.add(id);
    if (id !== undefined && /^\S/.test(line) && row === null) id = undefined;
  }
  return disabled;
}

async function setPatchDisabled(path: string, id: string, disabled: boolean): Promise<void> {
  const original = (await exists(path)) ? await readFile(path, "utf8") : "[]\n";
  const withoutEmpty = original.trim() === "[]" ? "" : original.trimEnd();
  const escaped = escapeRegExp(id);
  const block = new RegExp(`(^\\s*-\\s+id:\\s*['\"]?${escaped}['\"]?[^\\n]*\\n(?:^[ \\t]+[^\\n]*\\n?)*)`, "m");
  let next: string;
  const match = block.exec(withoutEmpty);
  if (match === null) {
    next = `${withoutEmpty.length === 0 ? "" : `${withoutEmpty}\n`}\n- id: ${id}\n  disabled: ${disabled}\n`;
  } else {
    const updated = /(^|\n)[ \t]+disabled:/.test(match[1] ?? "")
      ? (match[1] ?? "").replace(/(^|\n)([ \t]+disabled:)\s*(?:true|false)/, `$1$2 ${disabled}`)
      : `${match[1]?.trimEnd()}\n  disabled: ${disabled}\n`;
    next = `${withoutEmpty.slice(0, match.index)}${updated}${withoutEmpty.slice(match.index + (match[1]?.length ?? 0))}`;
  }
  await writeTextAtomic(path, next.endsWith("\n") ? next : `${next}\n`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isWithin(root: string, target: string): boolean {
  const relative = target.slice(resolve(root).length);
  return target === resolve(root) || (relative.startsWith("\\") || relative.startsWith("/")) && !relative.includes("..\\") && !relative.includes("../");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
