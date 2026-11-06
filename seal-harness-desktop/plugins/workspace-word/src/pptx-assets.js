import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pptxAssetBase } from './pptx-asset-path.js'

// PPTX and XLSX share this distribution directory. Keep their Worker and WASM
// files beside their entry modules so relative imports resolve in the browser.
export function registerPptxAssets(fetch) {
  const require = createRequire(import.meta.url)
  const directory = dirname(require.resolve('@silurus/ooxml/pptx'))
  for (const name of readdirSync(directory)) {
    if (!/^[\w.-]+\.(?:js|mjs|wasm)$/u.test(name)) continue
    const path = join(directory, name)
    fetch.register({
      path: `${pptxAssetBase}${name}`,
      methods: ['GET'],
      // The desktop HTTP bridge's streaming mode attaches a body even to GET.
      requestBody: 'buffered',
      async fetch() {
        const type = name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8'
        return new Response(readFileSync(path), {
          headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        })
      },
    })
  }
}
