import { describe, expect, it } from "vitest";
import { defaultPluginInventoryPreset, enabledPluginPresets, filterPluginInventory, orderPluginInventoryEntries, shortPluginModuleName } from "../public/plugin-inventory.js";

describe("plugin inventory", () => {
  it("puts failed rows first and otherwise sorts by module", () => {
    expect(orderPluginInventoryEntries([{ entryId: "z", moduleName: "zeta", fiberPhase: "active" }, { entryId: "f", moduleName: "failure", fiberPhase: "failed" }, { entryId: "a", moduleName: "alpha", fiberPhase: "pending" }]).map((entry) => entry.entryId)).toEqual(["f", "a", "z"]);
  });

  it("filters global and preset rows by module and entry id", () => {
    const snapshot = { entries: [{ entryId: "official", moduleName: "@fixture/official" }], agentPresets: [{ id: "standard", trust: "system", rows: [{ entryId: "tools", moduleName: "@deepseek-ai/dsh-tools" }] }] };
    expect(filterPluginInventory(snapshot, "tools").agentPresets[0]!.rows).toHaveLength(1);
    expect(filterPluginInventory(snapshot, "official").entries).toHaveLength(1);
    expect(filterPluginInventory(snapshot, "system").agentPresets).toHaveLength(0);
    expect(filterPluginInventory(snapshot, "missing")).toEqual({ entries: [], agentPresets: [] });
  });

  it("selects the chosen or default preset and projects official display metadata", () => {
    const presets = [{ id: "one", isDefault: false, rows: [] }, { id: "two", isDefault: true, rows: [{ moduleName: "@deepseek-ai/dsh-tools", enabled: true }] }];
    expect(defaultPluginInventoryPreset(presets)?.id).toBe("two");
    expect(defaultPluginInventoryPreset(presets, "one")?.id).toBe("one");
    expect(shortPluginModuleName("@deepseek-ai/dsh-host-plugin-inventory")).toBe("plugin-inventory");
    expect(enabledPluginPresets(presets).get("@deepseek-ai/dsh-tools")).toEqual([presets[1]]);
  });
});
