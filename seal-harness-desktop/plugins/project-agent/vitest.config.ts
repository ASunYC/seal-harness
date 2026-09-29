import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
const require = createRequire(import.meta.url)
export default defineConfig({
  resolve: { alias: [{ find: 'zod', replacement: dirname(require.resolve('zod/package.json')) }] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
})
