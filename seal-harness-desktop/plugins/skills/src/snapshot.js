import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { readDirectory, safeRelative, SkillError } from './package.js'

/** DSH 会话保存完整技能正文；资源目录同时指向可重用的内容快照。 */
export async function snapshotSkill(definition, snapshots, signal) {
  if (!definition || definition.resourceBase?.kind !== 'directory' || !definition.path) return definition
  // 平铺 Markdown 的原生资源基址是整个来源根；保留此契约，不复制其他技能。
  if (basename(definition.path) !== 'SKILL.md') return definition
  const source = definition.resourceBase.path, files = await readDirectory(source, signal)
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) hash.update(file.path).update('\0').update(String(file.mode)).update('\0').update(file.bytes).update('\0')
  const root = join(snapshots, hash.digest('hex'))
  for (const file of files) {
    const path = join(root, safeRelative(file.path))
    await mkdir(dirname(path), { recursive: true })
    try { await writeFile(path, file.bytes, { flag: 'wx', mode: file.mode }) }
    catch (error) { if (error.code !== 'EEXIST' || !(await readFile(path)).equals(file.bytes)) throw new SkillError('技能历史资源快照内容发生变化') }
  }
  return { ...definition, path: join(root, safeRelative(relative(source, definition.path))), resourceBase: { kind: 'directory', path: root } }
}
