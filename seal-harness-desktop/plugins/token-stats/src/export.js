import AdmZip from 'adm-zip'
import { metricKeys } from './query.js'

const xml = value => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const header = ['分组', '完成轮次', '未缓存输入', '输出', '总 Tokens', '缓存读取', '缓存写入', '推理输出（输出子集）']
const rowValues = row => [row.label, row.turns, ...metricKeys.map(key => row[key])]

function worksheet(rows) {
  const body = rows.map((values, index) => `<row r="${index + 1}">${values.map((value, column) => {
    const ref = `${String.fromCharCode(65 + column)}${index + 1}`
    return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '未提供')}</t></is></c>`
  }).join('')}</row>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="42" customWidth="1"/><col min="2" max="8" width="19" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`
}

export function workbookExport(snapshot) {
  const sheets = [
    ['汇总', [header, rowValues({ label: '区间汇总', ...snapshot.summary }), ['起始日期', snapshot.query.from], ['结束日期', snapshot.query.to], ['时区', snapshot.query.timeZone], ['统计范围', snapshot.scope], ['未返回完整用量轮次', snapshot.unavailableTurns]]],
    ['每日', [header, ...snapshot.byDay.map(rowValues)]],
    ['专家', [header, ...snapshot.byExpert.map(rowValues)]],
    ['模型', [header, ...snapshot.byModel.map(rowValues)]],
  ]
  const zip = new AdmZip()
  const add = (path, text) => zip.addFile(path, Buffer.from(text, 'utf8'))
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`)
  sheets.forEach(([, rows], i) => add(`xl/worksheets/sheet${i + 1}.xml`, worksheet(rows)))
  return { filename: `seal-token-usage-${snapshot.query.from}-${snapshot.query.to}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: zip.toBuffer().toString('base64') }
}
