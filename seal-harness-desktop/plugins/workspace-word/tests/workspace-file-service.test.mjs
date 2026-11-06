import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceFileService } from '../src/workspace-file-service.js'

test('file shortcuts use a validated workspace file and the native save/trash actions', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-file-shortcuts-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace')
  await mkdir(workspace)
  const source = join(workspace, 'example.txt')
  const outside = join(home, 'outside.txt')
  const saved = join(home, 'saved.txt')
  await writeFile(source, 'hello')
  await writeFile(outside, 'secret')
  const calls = []
  const files = new WorkspaceFileService({
    sessions: { get: id => id === 's1' ? { header: { cwd: workspace } } : undefined },
    sandboxPolicy: { workspaceRoot: workspace },
    fs: { processPathFromHostPath: value => value },
    native: {
      openPath: async path => { calls.push(['open', path]); return '' },
      savePath: async name => { calls.push(['save', name]); return saved },
      trashItem: async path => { calls.push(['trash', path]); await rm(path) },
    },
  })
  const input = { sessionId: 's1', path: source }
  assert.deepEqual(await files.openSystem(input), { opened: true })
  assert.deepEqual(await files.saveCopy(input), { path: saved })
  assert.equal(await readFile(saved, 'utf8'), 'hello')
  assert.deepEqual(calls.slice(0, 2), [['open', source], ['save', 'example.txt']])
  await assert.rejects(files.openSystem({ sessionId: 's1', path: outside }), { code: 'outsideWorkspace' })
  await assert.rejects(files.saveCopy({ sessionId: 'missing', path: source }), { code: 'sessionUnavailable' })
  const linked = join(workspace, 'linked.txt')
  await link(outside, linked)
  await assert.rejects(files.trash({ sessionId: 's1', path: linked }), { code: 'invalidPath' })
  assert.deepEqual(await files.trash(input), { deleted: true })
  assert.deepEqual(calls.at(-1), ['trash', source])
})
