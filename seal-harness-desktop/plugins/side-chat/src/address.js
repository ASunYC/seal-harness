export const sideChatPrefix = 'dsh-resource://seal-side-chat/session/'

export function sideChatAddress(parentSessionId, sideSessionId) {
  return `${sideChatPrefix}${encodeURIComponent(sideSessionId)}?parent=${encodeURIComponent(parentSessionId)}`
}

export function parseSideChatAddress(address) {
  try {
    const url = new URL(address)
    if (url.protocol !== 'dsh-resource:' || url.hostname !== 'seal-side-chat') return undefined
    const parts = url.pathname.split('/').filter(Boolean)
    const parentSessionId = url.searchParams.get('parent')
    if (parts.length !== 2 || parts[0] !== 'session' || !parentSessionId) return undefined
    const sideSessionId = decodeURIComponent(parts[1])
    return sideSessionId ? { parentSessionId, sideSessionId } : undefined
  } catch {
    return undefined
  }
}

export function quotedSelection(text) {
  const clean = text.trim().slice(0, 12000)
  return clean ? `引用主对话：\n${clean.split('\n').map(line => `> ${line}`).join('\n')}\n\n` : ''
}
