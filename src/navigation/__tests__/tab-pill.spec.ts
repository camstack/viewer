import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { navItems } from '../nav-items.js'
import { tabPillTarget } from '../tab-pill.js'

describe('the sliding tab pill target', () => {
  const W = 320

  it('sits on the active slot: index and offset follow the active segment', () => {
    const grids = tabPillTarget('/grids', navItems, W)
    expect(grids.index).toBe(1)
    expect(grids.width).toBe(W / navItems.length)
    expect(grids.x).toBe(grids.width)
    expect(grids.visible).toBe(true)
    expect(tabPillTarget('/cameras', navItems, W).x).toBe(0)
    expect(tabPillTarget('/notifications', navItems, W).index).toBe(navItems.length - 1)
  })

  it('moves when the destination changes (a different target index)', () => {
    expect(tabPillTarget('/events', navItems, W).index).not.toBe(tabPillTarget('/grids', navItems, W).index)
  })

  it('is hidden with no lit entry (Settings) and before the row is measured', () => {
    expect(tabPillTarget(null, navItems, W).visible).toBe(false)
    expect(tabPillTarget('/grids', navItems, 0).visible).toBe(false)
    expect(tabPillTarget('/nowhere', navItems, W).index).toBe(-1)
  })

  it('the bar slides ONE pill with a spring and cross-fades the faces', () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'BottomNavBar.tsx'),
      'utf8',
    )
    const pill = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'ui', 'SlidingGlassPill.tsx'),
      'utf8',
    )
    expect(pill).toContain('springTo(target.x, reduced, MOTION.tabPill.spring)')
    expect(pill).toContain('translateX: x.get()')
    expect(src).toContain('<TabFace')
    // First placement is the initial value, not a slide in from the left edge.
    expect(src).toContain('rowWidth > 0 ? <SlidingGlassPill')
  })
})
