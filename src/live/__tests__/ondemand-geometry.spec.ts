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
  cornerPosition,
  nearestCorner,
  onDemandArea,
  onDemandChromeWidth,
  ONDEMAND_CORNERS,
  DEFAULT_ONDEMAND_CORNER,
  NO_ONDEMAND_INSETS,
  type OnDemandInsets,
  snapSizeForWidth,
  nextSnapSize,
  resolveOnDemandBox,
  DEFAULT_ONDEMAND_SIZE,
  ONDEMAND_CHROME_HEIGHT,
  ONDEMAND_EDGE_INSET,
  ONDEMAND_MIN_WIDTH,
  ONDEMAND_OVERLAY_Z,
  ONDEMAND_SIZES,
  type OnDemandContainer,
  type OnDemandSize,
  resizedWidth,
  ONDEMAND_RESIZE_GRIP,
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
    const barWidth = onDemandChromeWidth(resolveOnDemandBox('compact', { width: 300, height: 900 }))
    // What the overlay really hands the bar: no record control, no frame-step,
    // a fixed chrome height (no second row), `small` density (no provider
    // density). Priced with the generic host — record, step — the full row
    // would not fit, which is why the host is stated rather than defaulted.
    const host = {
      scale: scaleForWidth(barWidth),
      canWrap: false,
      trailingIcon: false,
      canStep: false,
    }
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

/** A phone: safe area on top and bottom, the home bar above, the tab capsule below. */
const PHONE_INSETS: OnDemandInsets = {
  top: 47 + 48,
  right: 0,
  bottom: 72 + 34,
  left: 0,
}
const PHONE_WIN = { width: 390, height: 844 }

describe('the timeline spans the whole panel', () => {
  /** The grip used to reserve 28pt + 2×2pt of padding out of the bar's row. */
  it('is the panel width, edge to edge, at every size', () => {
    for (const container of [WIDE, PHONE_WIN]) {
      for (const size of ONDEMAND_SIZES) {
        const box = resolveOnDemandBox(size, container)
        expect(onDemandChromeWidth(box), `${size} @ ${container.width}`).toBe(box.width)
      }
    }
  })
})

describe('the four corners', () => {
  const box = resolveOnDemandBox('compact', onDemandArea(PHONE_WIN, PHONE_INSETS))

  it('rests bottom-right unless told otherwise', () => {
    expect(DEFAULT_ONDEMAND_CORNER).toBe('bottomRight')
  })

  it('anchors each corner inside the insets, by value', () => {
    const at = (c: (typeof ONDEMAND_CORNERS)[number]) =>
      cornerPosition(c, box, PHONE_WIN, PHONE_INSETS)
    const left = PHONE_INSETS.left + ONDEMAND_EDGE_INSET
    const top = PHONE_INSETS.top + ONDEMAND_EDGE_INSET
    const right = PHONE_WIN.width - PHONE_INSETS.right - ONDEMAND_EDGE_INSET - box.width
    const bottom = PHONE_WIN.height - PHONE_INSETS.bottom - ONDEMAND_EDGE_INSET - box.height
    expect(at('topLeft')).toEqual({ x: left, y: top })
    expect(at('topRight')).toEqual({ x: right, y: top })
    expect(at('bottomLeft')).toEqual({ x: left, y: bottom })
    expect(at('bottomRight')).toEqual({ x: right, y: bottom })
  })

  /** The tab capsule and the header are NEVER covered by a resting window. */
  it('never overlaps the header or the tab bar, in any corner at any size', () => {
    for (const size of ONDEMAND_SIZES) {
      const b = resolveOnDemandBox(size, onDemandArea(PHONE_WIN, PHONE_INSETS))
      for (const corner of ONDEMAND_CORNERS) {
        const p = cornerPosition(corner, b, PHONE_WIN, PHONE_INSETS)
        expect(p.y, `${size} ${corner}`).toBeGreaterThanOrEqual(PHONE_INSETS.top)
        expect(p.y + b.height, `${size} ${corner}`).toBeLessThanOrEqual(
          PHONE_WIN.height - PHONE_INSETS.bottom,
        )
        expect(p.x).toBeGreaterThanOrEqual(PHONE_INSETS.left)
        expect(p.x + b.width).toBeLessThanOrEqual(PHONE_WIN.width - PHONE_INSETS.right)
      }
    }
  })

  it('keeps a box larger than the area on screen rather than at a negative coordinate', () => {
    const tiny = { width: 300, height: 200 }
    const huge = { width: 900, height: 600 }
    for (const corner of ONDEMAND_CORNERS) {
      const p = cornerPosition(corner, huge, tiny, NO_ONDEMAND_INSETS)
      expect(p).toEqual({ x: ONDEMAND_EDGE_INSET, y: ONDEMAND_EDGE_INSET })
    }
  })

  /** A corner is a NAME: the same corner re-resolves in a different window. */
  it('re-resolves in a smaller window instead of stranding the player', () => {
    const narrow = { width: 1000, height: 700 }
    const b = resolveOnDemandBox('medium', narrow)
    const p = cornerPosition('bottomRight', b, narrow, NO_ONDEMAND_INSETS)
    expect(p.x + b.width).toBeLessThanOrEqual(narrow.width - ONDEMAND_EDGE_INSET + 0.001)
    expect(p.y + b.height).toBeLessThanOrEqual(narrow.height - ONDEMAND_EDGE_INSET + 0.001)
  })
})

describe('where a released drag snaps', () => {
  const box = resolveOnDemandBox('compact', onDemandArea(PHONE_WIN, PHONE_INSETS))
  const dropAt = (cx: number, cy: number) =>
    nearestCorner({ x: cx - box.width / 2, y: cy - box.height / 2 }, box, PHONE_WIN, PHONE_INSETS)

  it('takes the quadrant of the usable area the window was dropped in', () => {
    expect(dropAt(60, 200)).toBe('topLeft')
    expect(dropAt(330, 200)).toBe('topRight')
    expect(dropAt(60, 700)).toBe('bottomLeft')
    expect(dropAt(330, 700)).toBe('bottomRight')
  })

  it('measures the middle of the area the insets leave, not of the window', () => {
    const midY = PHONE_INSETS.top + (PHONE_WIN.height - PHONE_INSETS.top - PHONE_INSETS.bottom) / 2
    expect(dropAt(60, midY - 1)).toBe('topLeft')
    expect(dropAt(60, midY + 1)).toBe('bottomLeft')
  })

  it('answers a corner for a point anywhere, even off screen', () => {
    for (const corner of ONDEMAND_CORNERS) {
      const p = cornerPosition(corner, box, PHONE_WIN, PHONE_INSETS)
      expect(nearestCorner(p, box, PHONE_WIN, PHONE_INSETS)).toBe(corner)
    }
    expect(dropAt(-5000, -5000)).toBe('topLeft')
    expect(dropAt(5000, 5000)).toBe('bottomRight')
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

describe('the resize grip grows the panel away from its corner', () => {
  it('anchored right: dragging left grows, right shrinks', () => {
    expect(resizedWidth(300, { dx: -50, dy: 0 }, 'bottomRight')).toBe(350)
    expect(resizedWidth(300, { dx: 50, dy: 0 }, 'topRight')).toBe(250)
  })
  it('anchored left: dragging right grows', () => {
    expect(resizedWidth(300, { dx: 50, dy: 0 }, 'topLeft')).toBe(350)
    expect(resizedWidth(300, { dx: -50, dy: 0 }, 'bottomLeft')).toBe(250)
  })
  it('anchored bottom: dragging up grows; anchored top: dragging down grows', () => {
    expect(resizedWidth(300, { dx: 0, dy: -9 }, 'bottomLeft')).toBeCloseTo(316)
    expect(resizedWidth(300, { dx: 0, dy: 9 }, 'topLeft')).toBeCloseTo(316)
    expect(resizedWidth(300, { dx: 0, dy: 9 }, 'bottomLeft')).toBeCloseTo(284)
  })
  it('never goes negative, and the grip is a named size', () => {
    expect(resizedWidth(10, { dx: 500, dy: 0 }, 'bottomRight')).toBe(0)
    expect(ONDEMAND_RESIZE_GRIP).toBe(24)
  })
})
