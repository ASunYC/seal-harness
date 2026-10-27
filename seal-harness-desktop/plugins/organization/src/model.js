export function departmentPath(departments, id) {
  const byId = new Map(departments.map(item => [item.id, item]))
  const path = [], seen = new Set()
  while (id && byId.has(id) && !seen.has(id)) {
    seen.add(id)
    const item = byId.get(id)
    path.unshift(item)
    id = item.parentId
  }
  return path
}

export function descendantIds(departments, id) {
  const result = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const item of departments) {
      if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id)
        changed = true
      }
    }
  }
  return result
}

export function departmentPeople(snapshot, id) {
  const ids = descendantIds(snapshot.departments, id)
  return snapshot.people.filter(person => ids.has(person.departmentId))
}

export function matchingDirectory(snapshot, query) {
  const word = query.trim().toLocaleLowerCase()
  if (!word) return null
  return {
    departments: snapshot.departments.filter(item => item.name.toLocaleLowerCase().includes(word)),
    people: snapshot.people.filter(item => [item.name, item.jobTitle, item.email, item.phone,
      ...departmentPath(snapshot.departments, item.departmentId).map(department => department.name)]
      .some(value => value.toLocaleLowerCase().includes(word))),
  }
}
