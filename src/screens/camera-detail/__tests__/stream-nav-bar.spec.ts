/**
 * The main navigation over a single stream: when it is drawn, and what it costs
 * the column underneath.
 *
 * The second half is the one worth writing tests for. The operator's warning
 * was specific: the bar takes vertical space, and on a tablet the shelf of other
 * cameras lives under the picture — so the shelf must MEASURE what is left
 * rather than assume the window. This file proves both halves: that the two
 * cannot collide today (by value, over every viewport family), and that the
 * sizing subtracts the bar anyway so that a future breakpoint change cannot
 * make it collide silently.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { shouldShowStreamNavBar, streamColumnHeight } from '../stream-nav-bar.js'
import { shouldShowCameraShelf } from '../camera-shelf.js'
import { resolveDetailLayoutMode } from '../detail-layout.js'
import { shouldShowSidebar } from '../../../hooks/sidebar-rules.js'
import {
  BOTTOM_NAV_FALLBACK_INSET,
  BOTTOM_NAV_ROW_HEIGHT,
  bottomNavFootprint,
  bottomNavPaddingBottom,
} from '../../../navigation/bottom-nav-metrics.js'
import { STREAM_MAX_HEIGHT_FRACTION, computeWideDetailSizes } from '../wide-detail-sizes.js'

describe('the bar is off unless the operator asks for it', () => {
  it('is not drawn by default — the shipped behaviour is unchanged', () => {
    expect(shouldShowStreamNavBar({ enabled: false, showSidebar: false, fill: false })).toBe(false)
  })

  it('is drawn with the setting on, on a window that has no side rail', () => {
    expect(shouldShowStreamNavBar({ enabled: true, showSidebar: false, fill: false })).toBe(true)
  })

  it('is NOT drawn where the side rail already shows the same destinations', () => {
    // Two navigations for one app is worse than the one that was missing.
    expect(shouldShowStreamNavBar({ enabled: true, showSidebar: true, fill: false })).toBe(false)
  })

  it('is NOT drawn in fill — the picture owns the window, as it always has', () => {
    expect(shouldShowStreamNavBar({ enabled: true, showSidebar: false, fill: true })).toBe(false)
  })
})

/**
 * Every viewport family the app distinguishes, described the way the rules take
 * them: a WINDOW plus the DEVICE screen behind it (`sidebar-rules.ts` asks the
 * two different questions of the two different sources).
 */
const VIEWPORTS = [
  { name: 'iPhone portrait', width: 430, height: 932, screenMinSide: 430, isWeb: false },
  { name: 'iPhone landscape', width: 932, height: 430, screenMinSide: 430, isWeb: false },
  { name: 'iPad portrait', width: 834, height: 1194, screenMinSide: 834, isWeb: false },
  { name: 'iPad landscape', width: 1194, height: 834, screenMinSide: 834, isWeb: false },
  {
    name: 'iPad landscape, keyboard open',
    width: 1194,
    height: 600,
    screenMinSide: 834,
    isWeb: false,
  },
  { name: 'iPad half split view', width: 507, height: 1194, screenMinSide: 834, isWeb: false },
  { name: 'narrow web window', width: 420, height: 900, isWeb: true },
  { name: 'wide web window', width: 1440, height: 900, isWeb: true },
] as const

describe('the bar and the camera shelf cannot be on screen together', () => {
  for (const viewport of VIEWPORTS) {
    it(`${viewport.name}: at most one of the two`, () => {
      const input = { ...viewport, fullscreen: false }
      const mode = resolveDetailLayoutMode(input)
      const bar = shouldShowStreamNavBar({
        // The setting ON, deliberately: the claim must hold in the state the
        // operator can actually reach, not only in the default.
        enabled: true,
        showSidebar: shouldShowSidebar(viewport),
        fill: mode === 'fill',
      })
      const shelf = shouldShowCameraShelf(mode)
      expect(bar && shelf, `${viewport.name} drew both`).toBe(false)
    })
  }

  it('and the reason is structural: the shelf needs `wide`, which needs a rail', () => {
    // `wide` is (tablet AND landscape) or a >=1000pt web window, and every one
    // of those windows also satisfies `shouldShowSidebar`. Stated here so a
    // future breakpoint change breaks a test that says WHY, not just THAT.
    for (const viewport of VIEWPORTS) {
      const mode = resolveDetailLayoutMode({ ...viewport, fullscreen: false })
      if (!shouldShowCameraShelf(mode)) continue
      expect(shouldShowSidebar(viewport), `${viewport.name} is wide without a rail`).toBe(true)
    }
  })
})

describe('the column is sized from the space that is LEFT', () => {
  it('subtracts nothing when the bar is not drawn', () => {
    expect(streamColumnHeight({ windowHeight: 834, navBarFootprint: 0 })).toBe(834)
  })

  it('subtracts the whole footprint when it is', () => {
    expect(streamColumnHeight({ windowHeight: 834, navBarFootprint: 64 })).toBe(770)
  })

  /**
   * The claim in the operator's own terms: with the bar on, the shelf gets
   * less — and it gets less because the SPLIT moved, not because the shelf
   * overflowed something nobody told it about.
   *
   * How much less depends on which of `computeWideDetailSizes`' two regimes the
   * window is in, and both are pinned because reading only one of them is how
   * a wrong constant survives.
   */
  describe('and the space under the picture shrinks with it', () => {
    const below = (containerWidth: number, footprint: number): number => {
      const h = streamColumnHeight({ windowHeight: 834, navBarFootprint: footprint })
      return h - computeWideDetailSizes({ containerWidth, viewportHeight: h }).streamHeight
    }

    it('column-capped: the picture cannot use the height, so the shelf pays it all', () => {
      // 1194pt container → 814pt column, narrower than the 0.62 height cap
      // allows, so the picture is already as wide as the column and does not
      // shrink. Every one of the 64 points comes out of the shelf.
      expect(below(1194, 0) - below(1194, 64)).toBeCloseTo(64, 6)
    })

    it('height-capped: the picture shrinks too, so the shelf loses only its share', () => {
      // 1600pt container → 1220pt column, wider than the cap, so the picture IS
      // sized by the height and gives back its 62%. The shelf loses the other
      // 38% of the 64 points, and no more.
      expect(below(1600, 0) - below(1600, 64)).toBeCloseTo(
        64 * (1 - STREAM_MAX_HEIGHT_FRACTION),
        6,
      )
    })

    it('either way the shelf never loses more than the bar took', () => {
      for (const containerWidth of [1194, 1600]) {
        const lost = below(containerWidth, 0) - below(containerWidth, 64)
        expect(lost).toBeGreaterThan(0)
        expect(lost).toBeLessThanOrEqual(64)
      }
    })
  })

  it('refuses a degenerate result rather than sizing the picture to nothing', () => {
    // Same discipline as `resolveContainerWidth`: a bar taller than the window
    // is not a reason to hand `computeWideDetailSizes` a zero.
    expect(streamColumnHeight({ windowHeight: 40, navBarFootprint: 64 })).toBe(40)
    expect(streamColumnHeight({ windowHeight: 0, navBarFootprint: 64 })).toBe(0)
  })
})

describe('the footprint is the height that is actually drawn', () => {
  it('is zero while the bar is hidden', () => {
    expect(bottomNavFootprint({ visible: false, insetBottom: 34 })).toBe(0)
  })

  it('is the capsule plus the gap above the home indicator on a device that has one', () => {
    expect(bottomNavFootprint({ visible: true, insetBottom: 34 })).toBe(
      BOTTOM_NAV_ROW_HEIGHT + bottomNavPaddingBottom(34),
    )
    expect(bottomNavPaddingBottom(34)).toBe(26)
  })

  it('falls back to a small pad where there is no inset', () => {
    expect(bottomNavPaddingBottom(0)).toBe(BOTTOM_NAV_FALLBACK_INSET)
    expect(bottomNavPaddingBottom(-1)).toBe(BOTTOM_NAV_FALLBACK_INSET)
    expect(bottomNavPaddingBottom(Number.NaN)).toBe(BOTTOM_NAV_FALLBACK_INSET)
    expect(bottomNavFootprint({ visible: true, insetBottom: 0 })).toBe(
      BOTTOM_NAV_ROW_HEIGHT + BOTTOM_NAV_FALLBACK_INSET,
    )
  })

  it('and the bar draws exactly that, so the two cannot drift apart', () => {
    // The height is the ONE thing this module and the component must agree on:
    // a bar that grew to its content, or padded itself with its own copy of the
    // inset rule, would turn the camera detail's subtraction into a guess. The
    // BINDINGS are pinned, not merely the imports — naming a helper and not
    // using it for the height is exactly the drift this is here to catch.
    const bar = readFileSync(
      join(process.cwd(), 'src/navigation/BottomNavBar.tsx'),
      'utf8',
    )
    expect(bar).toMatch(/height:\s*bottomNavFootprint\(/)
    expect(bar).toMatch(/paddingBottom:\s*bottomNavPaddingBottom\(/)
    // The literal the extraction replaced. If it comes back the bar has a
    // second opinion about the inset.
    expect(bar).not.toMatch(/insetBottom\s*\|\|/)
  })
})

describe('the screen feeds the remaining height into the wide sizing', () => {
  // Not provable by mounting: the two states cannot coexist today (above), so
  // the wiring is asserted at the source and the arithmetic by value.
  const screen = readFileSync(
    join(process.cwd(), 'src/screens/CameraDetailScreen.tsx'),
    'utf8',
  )

  it('computeWideDetailSizes is given streamColumnHeight, never the raw window', () => {
    expect(screen).toContain('streamColumnHeight(')
    expect(screen).toMatch(/viewportHeight:\s*columnHeight/)
    expect(screen).not.toMatch(/viewportHeight:\s*winHeight/)
  })

  it('and the footprint it subtracts is the bar it actually mounts', () => {
    expect(screen).toContain('bottomNavFootprint(')
    expect(screen).toContain('shouldShowStreamNavBar(')
  })
})
