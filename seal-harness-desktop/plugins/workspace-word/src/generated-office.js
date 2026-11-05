const officeFile = /\.(?:docx|xlsx|pptx)$/iu
const absolutePath = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/u

export function workspaceOfficePath(path, cwd) {
  if (typeof path !== 'string' || !officeFile.test(path)) return null
  if (absolutePath.test(path)) return path
  if (typeof cwd !== 'string' || !absolutePath.test(cwd)) return null
  return `${cwd.replace(/[\\/]+$/u, '')}${cwd.includes('\\') ? '\\' : '/'}${path}`
}

export function generatedOfficePath(turn, seq, cwd) {
  const data = turn.data.get('deliverables')
  if (!data) return null
  const paths = [
    ...(data.presented ?? []).filter(file => file.seq < seq).sort((left, right) => left.seq - right.seq),
    ...(data.produced ?? []).filter(file => file.seq <= seq).sort((left, right) => left.seq - right.seq),
  ]
  for (let index = paths.length - 1; index >= 0; index--) {
    const path = workspaceOfficePath(paths[index].path, cwd)
    if (path) return path
  }
  return null
}

export function completedTurnFromChange(change, turn) {
  return change.kind === 'append' && change.entries.some(entry =>
    entry.type === 'event' && entry.event.type === 'turn/end'
    && entry.event.data.turn === turn && entry.event.data.reason.kind === 'completed')
}

export async function changedOfficePath(turn, sessionId, cwd, read = fetch) {
  const seq = turn.data.get('deliverables')?.changes?.seq
  if (!Number.isSafeInteger(seq)) return null
  const query = new URLSearchParams({ sessionId, seq: String(seq) })
  const response = await read(`api/changes.summary?${query}`)
  if (!response.ok) return null
  const summary = await response.json()
  if (summary.turn !== turn.turn || !Array.isArray(summary.files)) return null
  for (let index = summary.files.length - 1; index >= 0; index--) {
    const path = workspaceOfficePath(summary.files[index]?.path, cwd)
    if (path) return path
  }
  return null
}
