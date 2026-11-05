import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import JSZip from 'jszip'

test('GenOffice Worker edits a real DOCX and reparses the saved OOXML', async () => {
  const originalPostMessage = globalThis.postMessage
  const originalOnMessage = globalThis.onmessage
  let receive
  globalThis.postMessage = value => receive(value)
  try {
    await import('../lib/docx-worker.js')
    const invoke = request => new Promise(resolve => {
      receive = resolve
      globalThis.onmessage({ data: request })
    })
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blank.docx')
    const parsed = await invoke({ id: 1, kind: 'parse', bytes: await readFile(fixture) })
    assert.equal(parsed.kind, 'parsed')
    assert.equal(parsed.document.blocks[0].type, 'paragraph')
    const saved = await invoke({ id: 2, kind: 'serialize', blocks: [
      { kind: 'generated', block: { type: 'paragraph', runs: [{ text: 'Seal GenOffice 编辑测试' }] } },
    ] })
    assert.equal(saved.kind, 'serialized', saved.message)
    const zip = await JSZip.loadAsync(saved.bytes)
    const documentXml = await zip.file('word/document.xml').async('string')
    assert.match(documentXml, /Seal GenOffice 编辑测试/u)
    const reloaded = await invoke({ id: 3, kind: 'parse', bytes: saved.bytes })
    assert.equal(reloaded.kind, 'parsed')
    assert.equal(reloaded.document.blocks[0].runs[0].text, 'Seal GenOffice 编辑测试')
    const largeZip = await JSZip.loadAsync(await readFile(fixture))
    largeZip.file('word/media/large.bin', randomBytes(9 * 1024 * 1024), { compression: 'STORE' })
    const largeBytes = await largeZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    assert.ok(largeBytes.length > 8 * 1024 * 1024)
    const largeParsed = await invoke({ id: 4, kind: 'parse', bytes: largeBytes })
    assert.equal(largeParsed.kind, 'parsed', largeParsed.message)
  } finally {
    globalThis.postMessage = originalPostMessage
    globalThis.onmessage = originalOnMessage
  }
})
