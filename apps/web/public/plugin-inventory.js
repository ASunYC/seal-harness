const text = (value) => typeof value === "string" ? value : "";

export function orderPluginInventoryEntries(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const failure = Number(right?.fiberPhase === "failed") - Number(left?.fiberPhase === "failed");
    return failure || text(left?.moduleName).localeCompare(text(right?.moduleName)) || text(left?.entryId).localeCompare(text(right?.entryId));
  });
}

export function filterPluginInventory(snapshot, query) {
  const needle = text(query).trim().toLocaleLowerCase();
  const matches = (entry) => needle.length === 0 || `${text(entry?.moduleName)}\n${text(entry?.entryId)}`.toLocaleLowerCase().includes(needle);
  const presets = Array.isArray(snapshot?.agentPresets) ? snapshot.agentPresets : [];
  return {
    entries: orderPluginInventoryEntries(snapshot?.entries).filter(matches),
    agentPresets: presets.map((preset) => ({ ...preset, rows: orderPluginInventoryEntries(preset?.rows).filter(matches) }))
      .filter((preset) => needle.length === 0 || preset.rows.length > 0),
  };
}

export function defaultPluginInventoryPreset(presets, chosenId = null) {
  const rows = Array.isArray(presets) ? presets : [];
  return rows.find((preset) => preset?.id === chosenId) ?? rows.find((preset) => preset?.isDefault) ?? rows[0];
}

export function shortPluginModuleName(moduleName) {
  const value = text(moduleName);
  const unscoped = value.startsWith("@") ? value.slice(value.indexOf("/") + 1) : value;
  return unscoped.replace(/^cordis:/, "").replace(/^cordis-plugin-/, "").replace(/^dsh-(?:host-|client-)?/, "");
}

export function enabledPluginPresets(presets) {
  const found = new Map();
  for (const preset of Array.isArray(presets) ? presets : []) for (const row of Array.isArray(preset?.rows) ? preset.rows : []) {
    if (row?.enabled !== true) continue;
    const providers = found.get(row.moduleName) ?? [];
    if (!providers.includes(preset)) providers.push(preset);
    found.set(row.moduleName, providers);
  }
  return found;
}
