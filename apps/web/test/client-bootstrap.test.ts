// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "apps/web/public/client-bootstrap.js"), "utf8")
  .replace(/import\("\/vendor\/client-runtime\.mjs\?v=[^"]+"\)/, "Promise.resolve()");

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-dsh-client-boot");
  document.documentElement.removeAttribute("data-dsh-official-shell-mounted");
  history.replaceState(null, "", "/");
  delete (window as any).SealDshPlugins;
});

describe("Web client bootstrap shell selection", () => {
  it("mounts the optional DSH shell only when explicitly requested and ready", async () => {
    history.replaceState(null, "", "/#dsh-shell");
    const root = document.createElement("div"); root.id = "root"; document.body.append(root);
    const mountOfficialShell = vi.fn();
    (window as any).SealDshPlugins = { officialShellReady: () => true, mountOfficialShell };

    Function(source)();
    await vi.waitFor(() => expect(mountOfficialShell).toHaveBeenCalledOnce());

    expect(root.hidden).toBe(true);
    expect(mountOfficialShell).toHaveBeenCalledWith(document.getElementById("dsh-official-shell"));
    expect(document.documentElement.dataset.dshOfficialShellMounted).toBe("true");
  });

  it("keeps the Seal shell by default without activating DSH", async () => {
    const root = document.createElement("div"); root.id = "root"; document.body.append(root);
    const mountOfficialShell = vi.fn();
    (window as any).SealDshPlugins = { officialShellReady: () => true, mountOfficialShell };

    Function(source)();
    await Promise.resolve();

    expect(root.hidden).toBe(false);
    expect(mountOfficialShell).not.toHaveBeenCalled();
    expect(document.getElementById("dsh-official-shell")).toBeNull();
    expect(document.documentElement.dataset.dshClientBoot).toBe("ready");
  });
});
