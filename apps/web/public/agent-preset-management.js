export const AGENT_PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

export function agentPresetCopyIssue(id, presets) {
  if (id === "") return "required";
  if (!AGENT_PRESET_ID.test(id)) return "invalid";
  if ((Array.isArray(presets) ? presets : []).some((preset) => preset?.id === id)) return "taken";
  return null;
}

export function groupedAgentPresets(presets) {
  const rows = Array.isArray(presets) ? presets : [];
  return { system: rows.filter((preset) => preset?.trust === "system"), user: rows.filter((preset) => preset?.trust === "user") };
}

const BUILT_IN_COPY = Object.freeze({
  standard: ["settings.presetStandardName", "settings.presetStandardDescription"],
  ptc: ["settings.presetPtcName", "settings.presetPtcDescription"],
  minimal: ["settings.presetMinimalName", "settings.presetMinimalDescription"],
  cordis: ["settings.presetCordisName", "settings.presetCordisDescription"],
});

export function agentPresetDisplayText(preset, translate) {
  const keys = preset?.trust === "system" ? BUILT_IN_COPY[preset.id] : undefined;
  if (keys !== undefined) return { name: translate(keys[0]), description: translate(keys[1]) };
  return { name: preset?.name || preset?.id || "", ...(typeof preset?.description === "string" ? { description: preset.description } : {}) };
}
