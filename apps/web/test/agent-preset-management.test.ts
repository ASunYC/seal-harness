import { describe, expect, it } from "vitest";
import { agentPresetCopyIssue, agentPresetDisplayText, groupedAgentPresets } from "../public/agent-preset-management.js";

describe("agent preset management", () => {
  it("validates containment-safe, collision-free copy ids", () => {
    const presets = [{ id: "standard" }];
    expect(agentPresetCopyIssue("", presets)).toBe("required");
    expect(agentPresetCopyIssue("../escape", presets)).toBe("invalid");
    expect(agentPresetCopyIssue("Upper", presets)).toBe("invalid");
    expect(agentPresetCopyIssue("standard", presets)).toBe("taken");
    expect(agentPresetCopyIssue("my-preset-2", presets)).toBeNull();
  });

  it("groups only recognized trust values", () => {
    expect(groupedAgentPresets([{ id: "a", trust: "system" }, { id: "b", trust: "user" }, { id: "c", trust: "other" }])).toEqual({ system: [{ id: "a", trust: "system" }], user: [{ id: "b", trust: "user" }] });
  });

  it("localizes shipped presets while preserving user-authored copy", () => {
    const translate = (key: string) => `translated:${key}`;
    expect(agentPresetDisplayText({ id: "standard", trust: "system", name: "raw" }, translate)).toEqual({ name: "translated:settings.presetStandardName", description: "translated:settings.presetStandardDescription" });
    expect(agentPresetDisplayText({ id: "mine", trust: "user", name: "Mine", description: "Personal" }, translate)).toEqual({ name: "Mine", description: "Personal" });
  });
});
