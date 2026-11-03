import JSZip from 'jszip'
import { buildBlankDocx, parseDocx, saveDocx } from '@genoffice/docx-engine'
import { createBlankPptx, openPptx, savePptx, appendRawElements, insertBlankSlide } from '@genoffice/pptx-engine'
import { blankXlsxBuffer, csvToXlsxBuffer, isNumericCell } from '@genoffice/xlsx-gateway/gateway/csv-import'
import { readBasicWorkbook, createBufferEntrySource, planCellEditsToXlsx, assembleWithJsZip } from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import { parseAddress } from '@genoffice/xlsx-gateway/domain/cell-address'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'

const MAX_BLOCKS = 300
const limits = { maxParts: 2500, maxPartBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 }
const xml = (s: string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')
const text = (runs: any[]) => (runs ?? []).map(r => r.text ?? '').join('')


// 原始 ZIP 名称必须安全；不执行宏、外部关系或任何文档内代码。
async function policy(kind: string, bytes: Uint8Array) {
  await assertZipInflatesWithinLimits(bytes, limits)
  const zip = await JSZip.loadAsync(bytes)
  for (const part of Object.values(zip.files)) {
    const name = (part as any).unsafeOriginalName ?? part.name
    if (/^[a-z]:/i.test(name) || name.startsWith('/') || name.includes(String.fromCharCode(92)) || name.includes(String.fromCharCode(0)) || name.split('/').includes('..')) throw new Error('zip rejected: unsafe part path')
  }
  const paths = Object.keys(zip.files).filter(path => kind === 'docx' ? path === 'word/settings.xml'
    : kind === 'pptx' ? path === 'ppt/presentation.xml'
    : path === 'xl/workbook.xml' || /^xl\/worksheets\/[^/]+\.xml$/u.test(path))
  for (const path of paths) {
    const xml = await zip.file(path)!.async('string')
    const tags = xml.match(/<(?:[\w.-]+:)?(?:documentProtection|writeProtection|sheetProtection|modifyVerifier|fileSharing)\b[^>]*>/gu) ?? []
    for (const tag of tags) {
      if (/documentProtection\b/u.test(tag) && /\benforcement\s*=\s*["'](?:0|false|off)["']/iu.test(tag)) continue
      if (/sheetProtection\b/u.test(tag) && /\bsheet\s*=\s*["'](?:0|false|off)["']/iu.test(tag)) continue
      if (/fileSharing\b/u.test(tag) && !/(?:readOnlyRecommended\s*=\s*["'](?:1|true|on)["']|reservationPassword\s*=|hashValue\s*=)/iu.test(tag)) continue
      return { readOnly: true, readOnlyReason: '文档包含编辑保护，当前界面只读；原文件仍可导出。' }
    }
  }
  return { readOnly: false }
}

export async function inspect(kind: string, bytes: Uint8Array) {
  const protection = await policy(kind, bytes)
  let blocks: any[] = []
  if (kind === 'docx') {
    const doc = await parseDocx(bytes, { expandAltChunks: false })
    blocks = doc.blocks.filter(b => !b.hidden).map(b => ({ id: String(b.docxIndex), label: b.type, text: text(b.runs), editable: ['paragraph','heading','listItem'].includes(b.type) && b.docxIndex != null && !b.sdtShell }))
  } else if (kind === 'pptx') {
    const opened = await openPptx(bytes)
    blocks = opened.deck.slides.flatMap((slide, index) => slide.elements.filter(el => (el as any).text?.paragraphs).map(el => ({
      id: JSON.stringify([index, el.anchor.spIndex]), label: `Slide ${index + 1}`, text: (el as any).text.paragraphs.map(p => text(p.runs)).join('\n'), editable: el.type === 'text' || el.type === 'shape',
    })))
  } else if (kind === 'xlsx') {
    const workbook = await readBasicWorkbook(Buffer.from(bytes))
    blocks = workbook.snapshot.sheets.flatMap(sheet => Object.entries(sheet.cells).map(([address, cell]) => ({
      id: JSON.stringify([sheet.name, address]), label: `${sheet.name}!${address}`, text: cell.formula ? (cell.formula.startsWith('=') ? cell.formula : `=${cell.formula}`) : String(cell.value ?? ''), editable: true,
    })))
    // 空白表格也提供可编辑起点；新增单元格由明确地址操作完成。
    if (!blocks.length) blocks.push({ id: JSON.stringify([workbook.snapshot.sheets[0].name, 'A1']), label: `${workbook.snapshot.sheets[0].name}!A1`, text: '', editable: true })
  } else throw new Error('Unsupported document type')
  return { kind, ...protection, blocks: blocks.slice(0, MAX_BLOCKS).map(b => ({ ...b, editable: b.editable && !protection.readOnly })), totalBlocks: blocks.length, truncated: blocks.length > MAX_BLOCKS }
}

export async function create(kind: string, content: string) {
  if (kind === 'docx') {
    const parsed = await parseDocx(await buildBlankDocx())
    return saveDocx(parsed, content.split('\n').map(line => ({ kind: 'generated' as const, block: { type: 'paragraph' as const, runs: [{ text: line }] } })))
  }
  if (kind === 'xlsx') return content ? csvToXlsxBuffer(content, 'Sheet1') : blankXlsxBuffer()
  if (kind !== 'pptx') throw new Error('Unsupported document type')
  const opened = await openPptx(await createBlankPptx())
  const pages = content.split(/\n---\n/)
  if (pages.length > 50) throw new Error('At most 50 slides per creation; split the input instead of truncating it')
  for (let i = 0; i < pages.length; i++) {
    if (i) insertBlankSlide(opened, i - 1)
    const paragraphs = pages[i].split('\n').map(line => `<a:p><a:r><a:rPr lang="zh-CN" sz="2800"/><a:t>${xml(line)}</a:t></a:r></a:p>`).join('')
    if (!appendRawElements(opened, i, [`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="5486400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`])) throw new Error('Slide insertion failed')
  }
  return savePptx(opened)
}

export async function edit(kind: string, bytes: Uint8Array, updates: { id: string; text: string }[]) {
  const protection = await policy(kind, bytes)
  if (protection.readOnly) throw Object.assign(new Error(protection.readOnlyReason), { code: 'readOnlyDocument' })
  if (new Set(updates.map(x => x.id)).size !== updates.length) throw new Error('Duplicate edit target')
  if (kind === 'docx') {
    const parsed = await parseDocx(bytes, { expandAltChunks: false }), changed = new Map(updates.map(u => [u.id, u.text]))
    const blocks = parsed.blocks.filter(b => !b.hidden).map(b => {
      if (!changed.has(String(b.docxIndex))) return { kind: 'original' as const, docxIndex: b.docxIndex! }
      if (!['paragraph','heading','listItem'].includes(b.type) || b.docxIndex == null || b.sdtShell) throw new Error('This block is read-only')
      const value = changed.get(String(b.docxIndex))!; changed.delete(String(b.docxIndex))
      return { kind: 'generated' as const, docxIndex: b.docxIndex, block: { ...b, type: b.type as 'paragraph', runs: [{ ...(b.runs?.[0] ?? {}), text: value }] } }
    })
    if (changed.size) throw new Error('Unknown paragraph')
    return saveDocx(parsed, blocks)
  }
  if (kind === 'pptx') {
    const opened = await openPptx(bytes)
    for (const update of updates) {
      const [index, sourceIndex] = JSON.parse(update.id), el: any = opened.deck.slides[index]?.elements.find(x => x.anchor.spIndex === sourceIndex)
      if (!el?.text?.paragraphs || !['text','shape'].includes(el.type)) throw new Error('Unknown editable text box')
      const first = el.text.paragraphs[0] ?? { runs: [] }
      el.text.paragraphs = update.text.split('\n').map(line => ({ ...first, runs: [{ ...(first.runs[0] ?? {}), text: line }] }))
      el.dirty = true
    }
    return savePptx(opened)
  }
  if (kind !== 'xlsx') throw new Error('Unsupported document type')
  const workbook = await readBasicWorkbook(Buffer.from(bytes))
  const cells = updates.map(update => {
    const [sheetName, address] = JSON.parse(update.id)
    if (!workbook.snapshot.sheets.some(s => s.name === sheetName)) throw new Error('Unknown sheet')
    const { row, column } = parseAddress(address)
    if (row > 1048575 || column > 16383) throw new Error('Cell out of range')
    const formula = update.text.startsWith('=') ? update.text.slice(1) : undefined
    const value = formula ? null : isNumericCell(update.text) ? Number(update.text) : update.text
    return { sheetName, row, column, writeValue: true, cell: { value, ...(formula ? { formula } : {}) } }
  })
  const plan = await planCellEditsToXlsx(await createBufferEntrySource(Buffer.from(bytes)), cells)
  return (await assembleWithJsZip(Buffer.from(bytes), plan)).buffer
}
