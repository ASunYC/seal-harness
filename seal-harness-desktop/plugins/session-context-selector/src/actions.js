const PANEL = {
  expert: 'seal-harness-experts',
}
const RESOURCE_PANEL = {
  'seal-harness-experts': 'experts',
  'seal-harness-skills': 'skills',
  'seal-harness-connectors': 'connectors',
}

export function createPanelSelector(layout, navigation) {
  return panel => {
    const resource = RESOURCE_PANEL[panel]
    if (!resource) return layout.selectPanel(panel)
    navigation.select(resource)
    layout.selectPanel('seal-harness-home')
  }
}

export function createResourceActions({ inputActions, selectPanel }) {
  const insert = text => inputActions.insertText(text, inputActions.captureInsertion())
  return {
    skill: name => /^[a-z0-9][a-z0-9-]*$/.test(name) ? insert(`/${name} `) : false,
    expert: () => selectPanel(PANEL.expert),
  }
}
