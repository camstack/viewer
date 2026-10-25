import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TIMELINE_RAIL_WIDTH,
  TIMELINE_RAIL_WIDTH_NARROW,
} from '../../../../screens/camera-detail/wide-detail-sizes.js'
import {
  FULL_SIZE_TOKENS,
  MAX_SCALE,
  MIN_SCALE,
  REFERENCE_WIDTH,
  scaleForWidth,
  timelineTokens,
} from '../timeline-scale-tokens.js'
import { drawerWidth } from '../landscape-drawer-geometry.js'

describe('scaleForWidth', () => {
  it('is exactly 1 at the reference width — the tokens must not change portrait', () => {
    expect(scaleForWidth(REFERENCE_WIDTH)).toBe(1)
  })

  it('never grows chrome on a wide screen', () => {
    for (const w of [REFERENCE_WIDTH + 1, 834, 1280, 4096]) {
      expect(scaleForWidth(w)).toBe(MAX_SCALE)
    }
  })

  it('shrinks proportionally below the reference', () => {
    expect(scaleForWidth(REFERENCE_WIDTH / 2)).toBe(MIN_SCALE) // clamped
    expect(scaleForWidth(REFERENCE_WIDTH * 0.8)).toBeCloseTo(0.8, 5)
  })

  it('never goes below the floor, so a tap target stays hittable', () => {
    for (const w of [1, 40, 120, 200]) expect(scaleForWidth(w)).toBeGreaterThanOrEqual(MIN_SCALE)
  })

  it('treats a degenerate width as full size rather than collapsing', () => {
    for (const w of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scaleForWidth(w)).toBe(MAX_SCALE)
    }
  })
})

describe('timelineTokens', () => {
  it('returns the untouched theme values at the reference width', () => {
    const ui = timelineTokens(REFERENCE_WIDTH)
    expect(ui.space.md).toBe(8)
    expect(ui.radius.lg).toBe(8)
    expect(ui.font.md).toBe(14)
    expect(ui.control.button).toBe(30)
    expect(ui.control.primary).toBe(40)
    expect(ui.icon.md).toBe(18)
  })

  it('shrinks EVERY family together — the defect the hand-scaled version had', () => {
    const full = timelineTokens(REFERENCE_WIDTH)
    const small = timelineTokens(260)
    for (const pick of [
      (t: typeof full) => t.control.button,
      (t: typeof full) => t.control.primary,
      (t: typeof full) => t.control.arrow,
      (t: typeof full) => t.icon.md,
      (t: typeof full) => t.font.lg,
      (t: typeof full) => t.space.xl,
      (t: typeof full) => t.radius.xl,
    ]) {
      expect(pick(small)).toBeLessThan(pick(full))
    }
  })

  it('rounds to whole points so borders stay crisp', () => {
    const ui = timelineTokens(300)
    for (const v of [ui.control.button, ui.icon.md, ui.space.lg, ui.font.md]) {
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('never rounds a positive dimension away to zero', () => {
    const ui = timelineTokens(1) // hard floor
    expect(ui.space.xs).toBeGreaterThanOrEqual(1)
    expect(ui.px(1)).toBeGreaterThanOrEqual(1)
  })

  it('px() scales an arbitrary value on the same factor as the named tokens', () => {
    const ui = timelineTokens(300)
    expect(ui.px(30)).toBe(ui.control.button)
    expect(ui.px(18)).toBe(ui.icon.md)
  })

  it('FULL_SIZE_TOKENS is the identity set used outside any provider', () => {
    expect(FULL_SIZE_TOKENS.scale).toBe(1)
    expect(FULL_SIZE_TOKENS.control.primary).toBe(40)
  })
})

describe('the tokens the landscape drawer actually resolves', () => {
  it('keeps the primary play target big enough to hit on a real phone', () => {
    // 932pt landscape (iPhone 15 Pro Max) → drawer 317pt → the panel the
    // operator reported as "covering too much stream" with full-size chrome.
    const ui = timelineTokens(drawerWidth(932))
    expect(ui.control.primary).toBeGreaterThanOrEqual(28)
    // …and materially smaller than full size, which is the whole point.
    expect(ui.control.primary).toBeLessThan(40)
  })

  it('scales the drawer on a small phone too, not just the big one', () => {
    const small = timelineTokens(drawerWidth(667))
    const large = timelineTokens(drawerWidth(932))
    expect(small.scale).toBeLessThanOrEqual(large.scale)
    expect(small.scale).toBeGreaterThanOrEqual(MIN_SCALE)
  })
})

// ─── every compact container publishes the scale ──────────────────────

describe('the containers that are narrower than a phone', () => {
  it('the NARROW rail is one of them; the wide rail outgrew the reference', () => {
    // Arithmetic, not a judgement: a container under the 390pt reference is
    // compact by the same rule the landscape drawer is.
    //
    // The wide rail used to be 380 and therefore compact — it FITTED its
    // toolbar by shrinking it. On 2026-09-19 that stopped working: the
    // operator's iPad photographed the row wrapped onto two lines with the
    // profile menu clipped, so the rail went to 420. Above the reference, it
    // renders phone-sized chrome at phone size, which is the point — the
    // toolbar was always documented as fitting a 390pt phone.
    //
    // The narrow fallback stays under it and stays compact.
    expect(scaleForWidth(TIMELINE_RAIL_WIDTH_NARROW)).toBeLessThan(1)
    expect(scaleForWidth(TIMELINE_RAIL_WIDTH)).toBe(1)
  })

  it('both of them wrap their subtree in the provider', () => {
    // A container that is narrower than the reference and does NOT provide the
    // scale renders phone-sized chrome inside itself and never reaches
    // `compact` in `resolveClusterBand` — the wasted column, at a second site.
    const theater = readFileSync(
      join(process.cwd(), 'src/components/camera/theater/TheaterTimeline.tsx'),
      'utf8',
    )
    const drawer = readFileSync(
      join(process.cwd(), 'src/components/camera/theater/LandscapeTimelineOverlay.tsx'),
      'utf8',
    )
    // Matched on the OPENING tag plus its width, not on the whole literal: the
    // subject here is that each container provides the scale for its own width,
    // and pinning the exact prop list made adding one (`density`) fail a test
    // about wrapping.
    // The theater now goes through `MeasuredTimelineScale`, which MEASURES
    // its box and falls back to this estimate until the first layout pass —
    // the estimate is still the claim, because a first paint must not render
    // the narrowest tier and then visibly grow.
    expect(theater).toMatch(/<MeasuredTimelineScale[^>]*availableWidth=\{railWidth\}/)
    expect(drawer).toMatch(/<TimelineScaleProvider[^>]*availableWidth=\{box\.contentWidth\}/)
  })
})
