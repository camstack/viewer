/**
 * The on-demand player's box and placement, by value (D483).
 *
 * These are the claims the drag gestures rest on. A component test could only
 * assert that a View has a style; what matters is that a released gesture
 * commits to one of three sizes, and that a position stored in one window
 * cannot strand the player in the next.
 */
import { describe, it, expect } from 'vitest'
import {
  clampOnDemandPosition,
  defaultOnDemandPosition,
  snapSizeForWidth,
  nextSnapSize,
  resolveOnDemandBox,
  DEFAULT_ONDEMAND_SIZE,
  ONDEMAND_CHROME_HEIGHT,
  ONDEMAND_EDGE_INSET,
  ONDEMAND_CHROME_PADDING,
  ONDEMAND_MIN_WIDTH,
  ONDEMAND_OVERLAY_Z,
  ONDEMAND_RESIZE_GRIP,
  ONDEMAND_SIZES,
  type OnDemandContainer,
  type OnDemandSize,
} from '../ondemand-geometry.js'
import {
  estimateWidestBar,
  playbackBarFit,
  PLAYBACK_BAR_TIERS,
} from '../../components/camera/theater/playback-bar-fit.js'
import { scaleForWidth } from '../../components/camera/theater/timeline-scale-tokens.js'
import { STREAM_SLOT_Z } from '../../components/camera/theater/stream-slot.js'
import { DRAWER_OVERLAY_Z } from '../../components/camera/theater/landscape-drawer-geometry.js'

/** A wide web window. */
const WIDE = { width: 1400, height: 900 }

describe('the panel box', () => {
  it('is 16:9 plus the chrome, at the asked fraction of the container', () => {
    const box = resolveOnDemandBox('medium', WIDE)
    expect(box.width).toBeCloseTo(560, 5)
    expect(box.height).toBeCloseTo((560 * 9) / 16 + ONDEMAND_CHROME_HEIGHT, 5)
  })

  it('grows with the size, in the order the sizes are declared', () => {
    const widths = ONDEMAND_SIZES.map((s) => resolveOnDemandBox(s, WIDE).width)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
    expect(new Set(widths).size).toBe(ONDEMAND_SIZES.length)
  })

  /**
   * A wide-and-short window is the shape a landscape tablet with the keyboard
   * up actually is. The width has to come down; growing a panel taller than the
   * window would put its own controls off screen.
   */
  it('shrinks the WIDTH when the container is too short for the height', () => {
    const short = { width: 1400, height: 300 }
    const box = resolveOnDemandBox('large', short)
    expect(box.height).toBeLessThanOrEqual(short.height - 2 * ONDEMAND_EDGE_INSET)
    expect(box.width).toBeLessThan(resolveOnDemandBox('large', WIDE).width)
  })

  /**
   * The floor is a preference; the container is a fact. A panel whose minimum
   * exceeded the window would hang its own edge off screen, and unreachable is
   * worse than cramped.
   */
  it('lets the container beat the minimum width rather than overflow', () => {
    const tiny = { width: 200, height: 400 }
    const box = resolveOnDemandBox('compact', tiny)
    expect(box.width).toBeLessThan(ONDEMAND_MIN_WIDTH)
    expect(box.width).toBeLessThanOrEqual(tiny.width - 2 * ONDEMAND_EDGE_INSET)
  })

  /**
   * THE defect this ladder was rebuilt for (2026-09-13).
   *
   * The old rule was `max(ONDEMAND_MIN_WIDTH, container.width * fraction)`, and
   * on a phone every fraction sits under the floor: 0.26/0.4/0.56 of a 393pt
   * window is 102/157/220, all three below 280. So all three snaps returned
   * the SAME 280pt box. The drag fired, the snap returned a different
   * size, the store persisted it — and nothing moved. Even the ghost outline
   * was computed the same way, so the preview did not change size mid-drag
   * either. The handle was indistinguishable from dead, which is exactly how
   * the operator reported it: "the window does not appear to be resizable".
   */
  it('gives a PHONE three different sizes — the resize defect', () => {
    for (const phone of [
      { width: 375, height: 667 },
      { width: 393, height: 852 },
      { width: 430, height: 932 },
      { width: 852, height: 393 },
    ]) {
      const widths = ONDEMAND_SIZES.map((size) => resolveOnDemandBox(size, phone).width)
      expect(new Set(widths).size, `${phone.width}x${phone.height}`).toBe(ONDEMAND_SIZES.length)
      expect(widths, `${phone.width}x${phone.height}`).toEqual([...widths].sort((a, b) => a - b))
    }
  })

  /**
   * A resize the operator cannot SEE is the same defect in a smaller costume.
   * One step of the ladder has to be worth the gesture.
   */
  it('and each step is a visible change, not a rounding', () => {
    const phone = { width: 393, height: 852 }
    const widths = ONDEMAND_SIZES.map((size) => resolveOnDemandBox(size, phone).width)
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i] - widths[i - 1]).toBeGreaterThanOrEqual(40)
    }
  })

  /**
   * The wide ladder is UNCHANGED. Nobody complained about the web panel, and a
   * fix for a phone that quietly resizes every desktop window is a second
   * defect shipped with the first. The re-based ladder takes over only where
   * the fraction ladder had collapsed.
   */
  it('leaves a wide container exactly where it was', () => {
    expect(resolveOnDemandBox('compact', WIDE).width).toBeCloseTo(1400 * 0.26, 5)
    expect(resolveOnDemandBox('medium', WIDE).width).toBeCloseTo(1400 * 0.4, 5)
    expect(resolveOnDemandBox('large', WIDE).width).toBeCloseTo(1400 * 0.56, 5)
  })

  /**
   * The two ladders meet without a step the operator would see as a jump. At
   * the handover width the ends agree exactly and only the middle rung moves,
   * by a few points.
   */
  it('hands over between the two ladders without a visible jump', () => {
    const at = (width: number): number[] =>
      ONDEMAND_SIZES.map((size) => resolveOnDemandBox(size, { width, height: 1200 }).width)
    const before = at(920)
    const after = at(926)
    for (let i = 0; i < before.length; i += 1) {
      expect(Math.abs(after[i] - before[i]), ONDEMAND_SIZES[i]).toBeLessThan(20)
    }
  })

  /**
   * The panel's floor is what the playback bar needs, and the two numbers are
   * asserted against each other rather than both written down. The bar costs
   * 222pt once the tokens hit `MIN_SCALE`; the chrome takes 2pt of padding a
   * side and the resize grip reserves the bottom-right corner. At the floor the
   * bar must still be on its FULL tier — a smallest window that silently drops
   * controls is the resize defect wearing a different hat.
   */
  it('floors the panel where the full playback bar still fits', () => {
    const barWidth = ONDEMAND_MIN_WIDTH - 2 * ONDEMAND_CHROME_PADDING - ONDEMAND_RESIZE_GRIP
    // What the overlay really hands the bar: no record control, no frame-step,
    // a fixed chrome height (no second row), `small` density (no provider
    // density). Priced with the generic host — record, step — the full row
    // would not fit, which is why the host is stated rather than defaulted.
    const host = { scale: scaleForWidth(barWidth), canWrap: false, trailingIcon: false, canStep: false }
    expect(estimateWidestBar(PLAYBACK_BAR_TIERS[0], barWidth, host)).toBeLessThanOrEqual(barWidth)
    expect(playbackBarFit(barWidth, host)).toEqual(PLAYBACK_BAR_TIERS[0])
  })

  it('never returns a negative box for a degenerate container', () => {
    const box = resolveOnDemandBox('medium', { width: 0, height: 0 })
    expect(box.width).toBe(0)
    expect(box.height).toBe(0)
  })
})

describe('what a released resize drag commits to', () => {
  const PHONE = { width: 393, height: 852 }

  /** The exact widths this container's ladder produces — the thing a drag is
   *  being compared against. */
  const widthOf = (size: OnDemandSize, container: OnDemandContainer): number =>
    resolveOnDemandBox(size, container).width

  it('snaps to the size whose box the drag landed on', () => {
    for (const container of [WIDE, PHONE]) {
      for (const size of ONDEMAND_SIZES) {
        expect(snapSizeForWidth(widthOf(size, container), container), size).toBe(size)
      }
    }
  })

  it('snaps a drag between two sizes to the closer one', () => {
    const mid = (a: OnDemandSize, b: OnDemandSize): number =>
      (widthOf(a, PHONE) + widthOf(b, PHONE)) / 2
    expect(snapSizeForWidth(mid('compact', 'medium') - 10, PHONE)).toBe('compact')
    expect(snapSizeForWidth(mid('compact', 'medium') + 10, PHONE)).toBe('medium')
    expect(snapSizeForWidth(mid('medium', 'large') + 10, PHONE)).toBe('large')
  })

  it('clamps a drag past either end instead of falling through', () => {
    expect(snapSizeForWidth(0, WIDE)).toBe('compact')
    expect(snapSizeForWidth(99_999, WIDE)).toBe('large')
    expect(snapSizeForWidth(0, PHONE)).toBe('compact')
    expect(snapSizeForWidth(99_999, PHONE)).toBe('large')
  })

  /**
   * THE second no-op, and the one that would have survived a fix to the box
   * alone. The snap used to compare a dragged FRACTION against `SIZE_FRACTION`
   * (0.26 / 0.4 / 0.56). On a phone the panel's own widths are 0.61–0.92 of the
   * window, all past `large` — so every drag, in either direction, answered
   * `large`, and a drag to shrink the window grew it instead.
   */
  it('can still reach the SMALLEST size on a phone — both directions work', () => {
    expect(snapSizeForWidth(widthOf('large', PHONE) - 1, PHONE)).not.toBe('compact')
    expect(snapSizeForWidth(widthOf('compact', PHONE), PHONE)).toBe('compact')
    // Dragging inward from `large` must pass through every rung, not jump.
    const reached = new Set<OnDemandSize>()
    for (let w = 0; w <= widthOf('large', PHONE) + 60; w += 1) {
      reached.add(snapSizeForWidth(w, PHONE))
    }
    expect([...reached].sort()).toEqual([...ONDEMAND_SIZES].sort())
  })

  it('steps up and stops at the largest', () => {
    expect(nextSnapSize('compact')).toBe('medium')
    expect(nextSnapSize('medium')).toBe('large')
    expect(nextSnapSize('large')).toBe('large')
  })
})

describe('placement', () => {
  it('opens bottom-right, inset from both edges', () => {
    const box = resolveOnDemandBox('medium', WIDE)
    const at = defaultOnDemandPosition(box, WIDE)
    expect(at.x).toBeCloseTo(WIDE.width - box.width - ONDEMAND_EDGE_INSET, 5)
    expect(at.y).toBeCloseTo(WIDE.height - box.height - ONDEMAND_EDGE_INSET, 5)
  })

  it('keeps a position that is already inside', () => {
    const box = resolveOnDemandBox('compact', WIDE)
    expect(clampOnDemandPosition({ x: 300, y: 200 }, box, WIDE)).toEqual({ x: 300, y: 200 })
  })

  /**
   * The `container-width.ts` lesson at this scope: a position measured in one
   * window must not govern the next. Re-clamping on every read is what makes a
   * stale stored value self-correct instead of stranding the player.
   */
  it('pulls a position stored in a BIGGER window back on screen', () => {
    const narrow = { width: 1000, height: 700 }
    const box = resolveOnDemandBox('medium', narrow)
    const stale = { x: 1320, y: 840 } // valid in WIDE, off screen here
    const at = clampOnDemandPosition(stale, box, narrow)
    expect(at.x + box.width).toBeLessThanOrEqual(narrow.width - ONDEMAND_EDGE_INSET + 0.001)
    expect(at.y + box.height).toBeLessThanOrEqual(narrow.height - ONDEMAND_EDGE_INSET + 0.001)
  })

  it('refuses a negative coordinate — off the top-left is unreachable too', () => {
    const box = resolveOnDemandBox('compact', WIDE)
    expect(clampOnDemandPosition({ x: -500, y: -500 }, box, WIDE)).toEqual({
      x: ONDEMAND_EDGE_INSET,
      y: ONDEMAND_EDGE_INSET,
    })
  })

  it('keeps a box larger than its container on screen rather than at a negative x', () => {
    const tiny = { width: 300, height: 200 }
    const box = { width: 900, height: 600 }
    const at = clampOnDemandPosition({ x: 0, y: 0 }, box, tiny)
    expect(at.x).toBe(ONDEMAND_EDGE_INSET)
    expect(at.y).toBe(ONDEMAND_EDGE_INSET)
  })
})

describe('stacking', () => {
  /**
   * See `ONDEMAND_OVERLAY_Z`'s docblock for why this relation is a cheap
   * guarantee rather than a description of today's tree: mounted beside the
   * navigator the overlay is in its own stacking context, and paint order is
   * what puts it over a route. The assertion is here so that an overlay moved
   * INSIDE a screen by a later refactor cannot silently paint under the video,
   * which is how `LandscapeTimelineOverlay` once failed.
   */
  it('out-ranks the screen chrome it may one day share a context with', () => {
    expect(ONDEMAND_OVERLAY_Z).toBeGreaterThan(DRAWER_OVERLAY_Z)
    expect(ONDEMAND_OVERLAY_Z).toBeGreaterThan(STREAM_SLOT_Z)
  })
})

describe('the default size', () => {
  it('is one of the declared sizes, and not the smallest', () => {
    expect(ONDEMAND_SIZES).toContain(DEFAULT_ONDEMAND_SIZE)
    expect(DEFAULT_ONDEMAND_SIZE).not.toBe(ONDEMAND_SIZES[0])
  })
})
