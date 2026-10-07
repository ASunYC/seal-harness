import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DesktopDialogToneIcon,
  desktopDialogAdvisoryLines,
  desktopDialogButtonClassName,
  desktopDialogShowsToneIcon,
} from '../src/native-ui/desktop-dialog/App.tsx'

describe('Desktop dialog native UI', () => {
  it('omits the leading tone icon for the centered Profile compatibility surface', () => {
    expect(desktopDialogShowsToneIcon('profile-compatibility')).toBe(false)
    expect(desktopDialogShowsToneIcon('default')).toBe(true)
    expect(desktopDialogButtonClassName('profile-compatibility', 0)).toBe('mr-auto')
    expect(desktopDialogButtonClassName('profile-compatibility', 1)).toBeUndefined()
    expect(renderToStaticMarkup(createElement(DesktopDialogToneIcon, {
      type: 'warning',
    }))).toContain('<svg')
  })

  it('renders each compatibility advisory line as its own block', () => {
    expect(desktopDialogAdvisoryLines('Summary:\n1. First\n2. Second\nRecommendation')).toEqual([
      'Summary:',
      '1. First',
      '2. Second',
      'Recommendation',
    ])
  })

  it('uses the shared ScrollArea for long default dialog details', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<ScrollArea className="mt-2 h-28 pr-3">')
    expect(source).not.toContain('max-h-28 overflow-auto')
  })

  it('gives diagnostic details enough vertical space for long file-system paths', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<ScrollArea className="mt-3 h-64 rounded-lg border bg-muted/40">')
  })

  it('lets the user data directory tree fill the expanded window height', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    expect(source).toContain("dataLocations && 'h-screen overflow-hidden'")
    expect(source).toContain("dataLocations && 'min-h-0 flex-1'")
    expect(source).toContain('<ScrollArea className="mt-3 min-h-0 flex-1 rounded-lg border bg-muted/40">')
  })

  it('tones the advisory for both color schemes', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    // A bare `text-amber-100` is near white and disappears on the light-mode amber panel.
    expect(source).toContain('text-amber-900 dark:text-amber-100')
  })

})
