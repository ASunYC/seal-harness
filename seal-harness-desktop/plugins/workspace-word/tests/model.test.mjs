import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { desktopRequire } from '../../../scripts/build.mjs'

const require = createRequire(import.meta.url)

test('Word model converts an edited paragraph into a DOCX save plan', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'seal-word-model-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const { build } = await import(pathToFileURL(desktopRequire.resolve('tsdown')).href)
  await build({
    config: false, cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), outDir: temporary,
    entry: { model: 'src/vendor/office/docs/word-model.ts' }, format: 'cjs', platform: 'node', dts: false,
  })
  const { createWordModel, wordSaveBlocks } = require(join(temporary, 'model.cjs'))
  const priorPostMessage = globalThis.postMessage
  const priorOnMessage = globalThis.onmessage
  let receive
  globalThis.postMessage = response => receive(response)
  try {
    await import('../lib/docx-worker.js')
    const invoke = request => new Promise(resolve => {
      receive = resolve
      globalThis.onmessage({ data: request })
    })
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blank.docx')
    const parsed = await invoke({ id: 1, kind: 'parse', bytes: await readFile(fixture) })
    assert.equal(parsed.kind, 'parsed', parsed.message)
    const model = createWordModel(parsed.document.blocks)
    const paragraph = model.document.content.find(node => node.type === 'paragraph')
    assert(paragraph)
    paragraph.content = [{ type: 'text', text: 'Seal 模型编辑保存' }]
    const blocks = wordSaveBlocks(model.document, model)
    assert(blocks.some(block => block.kind === 'generated'))
    const saved = await invoke({ id: 2, kind: 'serialize', blocks })
    assert.equal(saved.kind, 'serialized', saved.message)
    const reloaded = await invoke({ id: 3, kind: 'parse', bytes: saved.bytes })
    assert.equal(reloaded.kind, 'parsed', reloaded.message)
    assert(reloaded.document.blocks.some(block => block.runs?.some(run => run.text === 'Seal 模型编辑保存')))
  } finally {
    globalThis.postMessage = priorPostMessage
    globalThis.onmessage = priorOnMessage
  }
})
