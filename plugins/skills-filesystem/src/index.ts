import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  contextServiceToken,
  type ContextContribution,
  type ContextRequest,
  type ContextSource,
  type PiHarnessEvents,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

export interface FilesystemSkillsConfig {
  readonly roots?: readonly string[];
  readonly maxSkillBytes?: number;
  readonly maxCatalogEntries?: number;
}

interface SkillEntry {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly content: string;
}

export class FilesystemSkillsSource implements ContextSource {
  readonly name = "skills-filesystem";

  constructor(readonly config: FilesystemSkillsConfig = {}) {}

  async contribute(request: ContextRequest): Promise<ContextContribution | undefined> {
    request.signal.throwIfAborted();
    const skills = await discoverSkills(
      request.cwd,
      this.config.roots ?? [".agents/skills", ".pi/skills"],
      this.config.maxSkillBytes ?? 64 * 1024,
      this.config.maxCatalogEntries ?? 100,
    );
    if (skills.length === 0) return undefined;

    const prompt = request.prompt
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const selected = skills.filter((skill) => prompt.includes(`$${skill.name}`));
    const catalog = skills.map((skill) =>
      `- ${skill.name}: ${skill.description} (${relative(request.cwd, skill.path).replaceAll("\\", "/")})`,
    ).join("\n");
    const sections = [
      `Available filesystem skills. Invoke one by writing $skill-name:\n${catalog}`,
      ...selected.map((skill) => `Selected skill $${skill.name}:\n${skill.content}`),
    ];
    return { systemPrompt: sections.join("\n\n") };
  }
}

export const filesystemSkillsPlugin = definePlugin<FilesystemSkillsConfig, PiHarnessEvents>({
  name: "skills-filesystem",
  requires: [contextServiceToken],
  setup(context, config) {
    context.effect(context.use(contextServiceToken).register(new FilesystemSkillsSource(config)));
  },
});

async function discoverSkills(
  cwd: string,
  roots: readonly string[],
  maxSkillBytes: number,
  maxEntries: number,
): Promise<SkillEntry[]> {
  const found = new Map<string, SkillEntry>();
  for (const configuredRoot of roots) {
    if (found.size >= maxEntries) break;
    const root = isAbsolute(configuredRoot) ? configuredRoot : resolve(cwd, configuredRoot);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.size >= maxEntries || !entry.isDirectory()) continue;
      const path = join(root, entry.name, "SKILL.md");
      try {
        const buffer = await readFile(path);
        const content = buffer.subarray(0, maxSkillBytes).toString("utf8");
        const metadata = parseFrontmatter(content, entry.name);
        if (!found.has(metadata.name)) {
          found.set(metadata.name, { ...metadata, path, content });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return [...found.values()];
}

function parseFrontmatter(
  content: string,
  fallbackName: string,
): { name: string; description: string } {
  if (!content.startsWith("---")) {
    return { name: fallbackName, description: "No description" };
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { name: fallbackName, description: "No description" };
  const values = new Map<string, string>();
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    values.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ""),
    );
  }
  return {
    name: values.get("name") || fallbackName,
    description: values.get("description") || "No description",
  };
}
