import { definePlugin, plugin } from "@seal-harness/kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxy = vi.hoisted(() => ({
  install: vi.fn(),
  dispose: vi.fn(),
  setupSettled: false,
}));

vi.mock("@deepseek-ai/dsh-http-proxy", () => ({
  installProxyFromEnvironment: vi.fn(async (environment: { get(name: string): { value: string } | undefined }) => {
    proxy.install(environment.get("SEAL_PROXY_TEST")?.value);
    proxy.setupSettled = true;
    return async () => { proxy.dispose(); };
  }),
}));

describe("startProfile proxy bootstrap", () => {
  beforeEach(() => { proxy.install.mockReset(); proxy.dispose.mockReset(); proxy.setupSettled = false; });
  afterEach(() => { delete process.env.SEAL_PROXY_TEST; });

  it("installs process proxy policy before Profile plugins and restores it on stop", async () => {
    process.env.SEAL_PROXY_TEST = "snapshot";
    const profilePlugin = definePlugin({
      name: "profile-probe",
      setup() { expect(proxy.setupSettled).toBe(true); },
    });
    const { startProfile } = await import("../src/start-profile.js");
    const kernel = await startProfile([plugin(profilePlugin, undefined)]);
    expect(proxy.install).toHaveBeenCalledWith("snapshot");
    await kernel.reconfigure([plugin(profilePlugin, undefined)]);
    expect(proxy.dispose).not.toHaveBeenCalled();
    await kernel.stop();
    expect(proxy.dispose).toHaveBeenCalledOnce();
  });

  it("restores proxy state when Profile startup fails", async () => {
    const broken = definePlugin({ name: "broken", setup() { throw new Error("broken profile"); } });
    const { startProfile } = await import("../src/start-profile.js");
    await expect(startProfile([plugin(broken, undefined)])).rejects.toThrow("Plugin failed to start: broken");
    expect(proxy.dispose).toHaveBeenCalledOnce();
  });
});
