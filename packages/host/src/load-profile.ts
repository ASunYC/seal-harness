import { access, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { EventMap } from "@seal-harness/kernel";
import { InvalidProfileError, ProfileNotFoundError } from "./errors.js";
import { assertProfile, type Profile } from "./profile.js";

export const DEFAULT_PROFILE_FILES = Object.freeze([
  "seal-harness.config.mjs",
  "seal-harness.config.js",
] as const);

export interface LoadProfileOptions {
  readonly cwd?: string;
  readonly configPath?: string;
}

export interface LoadedProfile<TEvents extends EventMap = EventMap> {
  readonly configPath: string;
  readonly profile: Profile<TEvents>;
}

export async function loadProfile<TEvents extends EventMap = EventMap>(
  options: LoadProfileOptions = {},
): Promise<LoadedProfile<TEvents>> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = options.configPath === undefined
    ? await discoverProfile(cwd)
    : await resolveExplicitProfile(cwd, options.configPath);

  let imported: { default?: unknown };
  try {
    imported = await import(pathToFileURL(configPath).href);
  } catch (cause) {
    throw new InvalidProfileError("Failed to import Seal Harness profile", configPath, { cause });
  }

  try {
    assertProfile<TEvents>(imported.default, configPath);
  } catch (cause) {
    if (cause instanceof InvalidProfileError) throw cause;
    throw new InvalidProfileError("Invalid Seal Harness profile", configPath, { cause });
  }

  return { configPath, profile: imported.default };
}

async function discoverProfile(cwd: string): Promise<string> {
  for (const candidate of DEFAULT_PROFILE_FILES) {
    const path = join(cwd, candidate);
    if (await exists(path)) return realpath(path);
  }
  throw new ProfileNotFoundError(cwd, DEFAULT_PROFILE_FILES);
}

async function resolveExplicitProfile(cwd: string, configPath: string): Promise<string> {
  const path = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
  if (!(await exists(path))) {
    throw new ProfileNotFoundError(cwd, [path]);
  }
  return realpath(path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
