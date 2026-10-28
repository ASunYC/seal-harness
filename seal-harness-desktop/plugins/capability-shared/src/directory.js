export const directoryGroups = Object.freeze([
  Object.freeze({ id: 'system', title: '系统' }),
  Object.freeze({ id: 'personal', title: '个人' }),
])

export function skillDirectory(item) {
  return ['store', 'system'].includes(item.origin?.kind) ? 'system' : 'personal'
}

export function connectorDirectory(item) {
  return item.source || item.catalogId ? 'system' : 'personal'
}

export function sessionSkillDirectory(skill, managedByName) {
  const managed = managedByName.get(skill.name)
  if (managed) return skillDirectory(managed)
  return ['bundled', 'runtime'].includes(skill.source) ? 'system' : 'personal'
}
