const PANEL = {
  expert: 'seal-harness-experts',
}

export function createResourceActions({ inputActions, selectPanel }) {
  const insert = text => inputActions.insertText(text, inputActions.captureInsertion())
  return {
    skill: name => /^[a-z0-9][a-z0-9-]*$/.test(name) ? insert(`/${name} `) : false,
    expert: () => selectPanel(PANEL.expert),
  }
}
