import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../src/default-profile.js";

describe("application data home", () => {
  it("keeps CLI defaults and redirects desktop persistence without changing cwd", () => {
    const cwd = join(process.cwd(), "fixture-workspace");
    const home = join(process.cwd(), "fixture-user-home");
    const local = createDefaultProfile({ cwd, provider: "deepseek" });
    const desktop = createDefaultProfile({ cwd, provider: "deepseek", dataHome: home });
    const paths = (profile: typeof local) => profile.flatMap(entry => {
      const config = entry.config as { path?: string; root?: string } | undefined;
      return config?.path ? [config.path] : config?.root ? [config.root] : [];
    });
    expect(paths(local)).toHaveLength(6);
    expect(paths(desktop)).toEqual(paths(local).map(path => path.replace(join(cwd, ".seal-harness"), home)));
    expect(paths(desktop).every(path => path.startsWith(home))).toBe(true);
  });
});
