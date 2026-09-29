import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { desktopRequire } from './build.mjs'

test('已装配文档入口使用同目录 worker 解析 Office 和 PDF', async () => {
  const parser = await import(pathToFileURL(desktopRequire.resolve('@seal-harness/projects/documents')))
  for (const format of ['docx', 'pdf', 'pptx']) {
    const fileName = `sample.${format}`
    const bytes = await readFile(new URL(`../plugins/projects/tests/host/main/services/__fixtures__/documents/${fileName}`, import.meta.url))
    const result = await parser.parseLocalDocument({ fileName, mimeType: parser.projectDocumentMimeType(fileName), bytes })
    assert.equal(result.format, format)
    assert(result.text.length > 0, `${format} should contain extracted text`)
  }
})
