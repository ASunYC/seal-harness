import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { desktopProduct, desktopProductDefine } from './scripts/product-config.ts'

const root = dirname(fileURLToPath(import.meta.url))
const uiRoot = resolve(root, 'src/native-ui')

/** Build the Desktop-owned static native surfaces without network dependencies. */
export default defineConfig({
  define: desktopProductDefine,
  plugins: [react(), tailwindcss(), {
    name: 'desktop-product-title',
    transformIndexHtml(html) {
      if (desktopProduct === undefined) return html
      const name = desktopProduct.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      return html.replace(/<title>(.*?)<\/title>/, (_, title: string) => `<title>${title.replaceAll('DSH Desktop', name)}</title>`)
    },
  }],
  root: uiRoot,
  base: './',
  resolve: { alias: { '@': resolve(root, 'src/native-ui') } },
  build: {
    outDir: resolve(root, 'lib/native-ui'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        'compatibility-chrome': resolve(uiRoot, 'compatibility-chrome.html'),
        'desktop-dialog': resolve(uiRoot, 'desktop-dialog.html'),
        recovery: resolve(uiRoot, 'recovery.html'),
        'profile-create': resolve(uiRoot, 'profile-create.html'),
        'profile-selector': resolve(uiRoot, 'profile-selector.html'),
        'setup-wizard': resolve(uiRoot, 'setup-wizard.html'),
      },
    },
  },
})
