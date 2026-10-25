// @vitest-environment jsdom
/**
 * Every menu is ONE readable glass: the People `⋯` menu read as bare text over
 * the face grid on iOS (operator, 2026-10-22). The native system glass is
 * nearly clear over pictures and may not draw at all inside a parent that
 * fades in from opacity 0 — which is every anchored menu — so the menu fill
 * lays the dense `bar` wash under it. The tab-level section selector wears the
 * same material.
 */
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import { SegmentedControl } from '../SegmentedControl.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8')

afterEach(cleanup)

describe('the menu glass', () => {
  it('every anchored menu (the ⋯ overflow included) is drawn on the menu fill', () => {
    expect(read('components/ui/AnchoredMenu.tsx')).toContain('<MenuGlassFill />')
    expect(read('components/ui/HeaderOverflowMenu.tsx')).toContain('<AnchoredMenu')
  })

  it('the menu fill asks for the dense wash, and the native glass draws it when asked', () => {
    expect(read('components/ui/GlassPanel.tsx')).toMatch(/<GlassSurface[^>]*\bdense\b/)
    const surface = read('components/ui/GlassSurface.tsx')
    const nativeBranch = surface.slice(surface.indexOf('<NativeGlass'), surface.indexOf('</NativeGlass>'))
    expect(nativeBranch).toMatch(/dense \? \(\s*<View[^>]*denseWash\(look\)/)
  })

  it('a Library menu body never claims a width of its own — the card (240 for the sort menu) owns it', () => {
    // A 260 minWidth inside a 240 card cut the sort menu's checkboxes at the right edge.
    const src = read('components/ui/LibraryFilterBar.tsx')
    const body = src.slice(src.indexOf('menuBody: {'), src.indexOf('}', src.indexOf('menuBody: {')))
    expect(body).not.toMatch(/minWidth|width:/)
  })

  it('the tab-level section selector is the glass segmented control', () => {
    expect(read('components/ui/ScopeBar.tsx')).toContain('variant="glass"')
    const glass = mountScreen(
      React.createElement(SegmentedControl, {
        options: [{ value: 'events', label: 'Events' }, { value: 'people', label: 'People' }],
        value: 'events',
        onChange: () => undefined,
        variant: 'glass',
      }),
    )
    expect(glass.getByTestId('segmented-control-glass')).toBeTruthy()
    glass.unmount()
    const solid = mountScreen(
      React.createElement(SegmentedControl, {
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
        value: 'a',
        onChange: () => undefined,
      }),
    )
    expect(solid.queryByTestId('segmented-control-glass')).toBeNull()
  })
})
