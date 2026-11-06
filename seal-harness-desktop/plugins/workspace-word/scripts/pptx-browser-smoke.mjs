import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { OfficeService } from '../../office/src/service.js'
import { registerPptxAssets } from '../src/pptx-assets.js'

async function twoSlideDeck(bytes) {
  const archive = await JSZip.loadAsync(bytes)
  const slide = await archive.file('ppt/slides/slide1.xml').async('string')
  const slideRels = await archive.file('ppt/slides/_rels/slide1.xml.rels').async('string')
  const presentation = await archive.file('ppt/presentation.xml').async('string')
  const relationships = await archive.file('ppt/_rels/presentation.xml.rels').async('string')
  const types = await archive.file('[Content_Types].xml').async('string')
  assert(slide.includes('Seal PPTX visual smoke'))
  assert(presentation.includes('<p:sldId id="256" r:id="rId2"/>'))
  archive.file('ppt/slides/slide2.xml', slide.replace('Seal PPTX visual smoke', 'Second visual slide'))
  archive.file('ppt/slides/_rels/slide2.xml.rels', slideRels)
  archive.file('ppt/presentation.xml', presentation.replace('</p:sldIdLst>', '<p:sldId id="257" r:id="rId3"/></p:sldIdLst>'))
  archive.file('ppt/_rels/presentation.xml.rels', relationships.replace('</Relationships>', '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'))
  archive.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'))
  return archive.generateAsync({ type: 'nodebuffer' })
}

const require = createRequire(resolve('dsh-plugin-desktop-beta/package.json'))
const { chromium } = require('playwright')
const desktopRequire = createRequire(resolve('seal-harness-desktop/package.json'))
const { build } = await import(pathToFileURL(desktopRequire.resolve('tsdown')).href)
const temporary = await mkdtemp(join(tmpdir(), 'seal-pptx-browser-'))
const office = new OfficeService({ root: join(temporary, 'office'), identity: { getSession: () => ({ accountId: 'smoke', epoch: 1 }), subscribe: () => () => {} } })
const routes = new Map()
registerPptxAssets({ register: route => routes.set(route.path, route) })
let browser
let server
try {
  await build({ config: false, cwd: resolve('seal-harness-desktop/plugins/workspace-word'),
    entry: { smoke: 'scripts/pptx-browser-smoke-entry.jsx' }, outDir: temporary,
    clean: false, dts: false, sourcemap: false, format: 'esm', platform: 'browser', target: 'es2022',
    deps: { alwaysBundle: [/^react(?:-dom)?(?:\/|$)/u] }, define: { 'process.env.NODE_ENV': JSON.stringify('production') } })
  const created = await office.transform({ action: 'create', kind: 'pptx', content: 'Seal PPTX visual smoke' })
  const presentation = await twoSlideDeck(created.bytes)
  const updatedArchive = await JSZip.loadAsync(presentation)
  updatedArchive.file('ppt/slides/slide2.xml', (await updatedArchive.file('ppt/slides/slide2.xml').async('string')).replace('Second visual slide', 'Saved visual update'))
  const updated = await updatedArchive.generateAsync({ type: 'nodebuffer' })
  server = createServer(async (request, response) => {
    const route = routes.get(request.url)
    if (route) {
      const result = await route.fetch()
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(Buffer.from(await result.arrayBuffer()))
    } else if (request.url === '/sample.pptx') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
      response.end(presentation)
    } else if (request.url === '/smoke.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      response.end(await readFile(join(temporary, 'smoke.js')))
    } else if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#171719"><div id="root"></div><script>window.samplePptxBase64=${JSON.stringify(presentation.toString('base64'))}</script><script type="module" src="/smoke.js"></script></body></html>`)
    } else { response.writeHead(404); response.end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  browser = await chromium.launch({ headless: true, ...(process.env.SEAL_PPTX_CHROMIUM ? { executablePath: process.env.SEAL_PPTX_CHROMIUM } : {}) })
  const page = await browser.newPage()
  page.on('pageerror', error => process.stderr.write(`PPTX browser error: ${error.message}\n`))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => document.querySelector('.seal-pptx-stage canvas')?.width >= 800 && document.querySelectorAll('.seal-pptx-thumbnail').length === 2, null, { timeout: 45_000 })
  const first = await page.locator('.seal-pptx-stage canvas').evaluate(canvas => canvas.toDataURL())
  await page.getByRole('button', { name: '第 2 页' }).click()
  await page.waitForFunction(previous => {
    const canvas = document.querySelector('.seal-pptx-stage canvas')
    return document.querySelector('.seal-pptx-preview-toolbar')?.textContent.includes('2 / 2 页') &&
      !document.querySelector('.seal-pptx-stage [role=status]') && canvas?.toDataURL() !== previous
  }, first, { timeout: 45_000 })
  const result = await page.evaluate(firstImage => {
    const canvas = document.querySelector('.seal-pptx-stage canvas')
    const copy = document.createElement('canvas')
    copy.width = canvas.width; copy.height = canvas.height
    const context = copy.getContext('2d')
    context.drawImage(canvas, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let colored = 0
    for (let i = 0; i < data.length; i += 64) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) colored++
    return { slides: document.querySelectorAll('.seal-pptx-thumbnail').length, width: canvas.width, height: canvas.height,
      colored, different: canvas.toDataURL() !== firstImage, thumbnailWidth: document.querySelectorAll('.seal-pptx-thumbnail canvas')[1].width }
  }, first)
  assert.equal(result.slides, 2)
  assert.equal(result.different, true)
  assert(result.thumbnailWidth >= 180)
  assert(result.width >= 800 && result.height >= 400)
  assert(result.colored > 20, `slide rendered blank: ${JSON.stringify(result)}`)
  const beforeUpdate = await page.locator('.seal-pptx-stage canvas').evaluate(canvas => canvas.toDataURL())
  await page.evaluate(base64 => window.replaceSmokePptx(base64), updated.toString('base64'))
  await page.waitForFunction(previous => {
    const canvas = document.querySelector('.seal-pptx-stage canvas')
    return canvas?.width >= 800 && !document.querySelector('.seal-pptx-stage [role=status]') && canvas.toDataURL() !== previous
  }, beforeUpdate, { timeout: 45_000 })
  await page.setViewportSize({ width: 650, height: 700 })
  if (process.env.SEAL_PPTX_SCREENSHOT) await page.screenshot({ path: resolve(process.env.SEAL_PPTX_SCREENSHOT) })
  await page.setViewportSize({ width: 360, height: 700 })
  const narrow = await page.evaluate(() => ({ body: document.querySelector('.seal-pptx-preview-body').getBoundingClientRect().width,
    toolbar: document.querySelector('.seal-pptx-preview-toolbar').scrollWidth,
    viewport: document.documentElement.clientWidth }))
  assert(narrow.body <= narrow.viewport && narrow.toolbar <= narrow.viewport, `narrow preview overflow: ${JSON.stringify(narrow)}`)
  process.stdout.write(`PPTX browser preview passed: ${JSON.stringify(result)}\n`)
} finally {
  await browser?.close()
  await new Promise(resolveClose => server?.close(resolveClose) ?? resolveClose())
  await office.dispose()
  await rm(temporary, { recursive: true, force: true })
}
