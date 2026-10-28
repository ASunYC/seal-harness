// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopFrameTitlebarView } from '../src/client/DesktopFrameTitlebarView.tsx'

const { product } = vi.hoisted(() => ({ product: {
  name: 'Seal Harness', version: '0.1.0', displayVersion: undefined as string | undefined, updatesEnabled: false,
} }))
vi.mock('../src/product-config.ts', () => ({ DESKTOP_PRODUCT: product }))
let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.unstubAllGlobals() })

it.each([undefined, '0.2.1-rc.2', '0.2.2'])('renders displayVersion %s without changing the Host product version', async displayVersion => {
  product.displayVersion = displayVersion
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const noop = async () => {}
  await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, {
    api: { openTerminal: noop, restart: noop, restartToRecovery: noop, reloadRenderer: noop, toggleDeveloperTools: noop, checkForUpdates: noop },
    setMode: noop, t: key => key,
    environment: { version: '0.1.0', mode: 'compatibility', platform: 'win32', material: 'off', micaSupported: false },
  })) })
  const expected = displayVersion ?? '0.1.0'
  const button = container.querySelector('.dshDesktopFrameVersion')!
  expect(button.getAttribute('aria-label')).toBe(`currentVersion v${expected}`)
  expect(button.textContent).toBe(`v${expected}`)
  expect(product.version).toBe('0.1.0')
})
