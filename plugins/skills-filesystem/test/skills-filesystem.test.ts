import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionId, text } from "@piharness/core";
import { FilesystemSkillsSource } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("FilesystemSkillsSource", () => {
  it("lists discovered skills and expands only an explicitly selected skill", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "piharness-skills-"));
    temporary.push(cwd);
    const root = join(cwd, ".agents", "skills");
    await mkdir(join(root, "alpha"), { recursive: true });
    await mkdir(join(root, "beta"), { recursive: true });
    await writeFile(join(root, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill\n---\nALPHA BODY");
    await writeFile(join(root, "beta", "SKILL.md"), "---\nname: beta\ndescription: Beta skill\n---\nBETA BODY");
    const source = new FilesystemSkillsSource();

    const contribution = await source.contribute({
      sessionId: sessionId("session"),
      cwd,
      history: [],
      prompt: [text("please use $alpha")],
      signal: new AbortController().signal,
    });

    expect(contribution?.systemPrompt).toContain("alpha: Alpha skill");
    expect(contribution?.systemPrompt).toContain("beta: Beta skill");
    expect(contribution?.systemPrompt).toContain("ALPHA BODY");
    expect(contribution?.systemPrompt).not.toContain("BETA BODY");
  });
});
