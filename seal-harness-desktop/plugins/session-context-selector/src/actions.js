const PANEL = {
  expert: 'seal-harness-experts',
}

export function createResourceActions({ inputActions, selectPanel }) {
  const insert = text => inputActions.insertText(text, inputActions.captureInsertion())
  return {
    skill: () => insert('/skill '),
    expert: () => selectPanel(PANEL.expert),
  }
}
