import { describe, it, expect } from 'vitest'

import {
  MOUNT_MARGIN_PX,
  MOUNT_STEP_PX,
  bandEpochRange,
  bandsEqual,
  itemsInBand,
  mountBand,
  scrollBand,
  spansInBand,
  ticksInBand,
  type MountBand,
} from '../timeline-window.js'
import { epochToOffset, layoutAnchorMs, msPerPixel, pxPerHour } from '../timeline-geometry.js'

const T0 = 1_700_000_000_000
const ZOOM = 2

function card(topPx: number, heightPx = 90): { topPx: number; heightPx: number; id: string } {
  return { topPx, heightPx, id: `c${topPx}` }
}

// ─── the band ─────────────────────────────────────────────────────────

describe('mountBand', () => {
  it('covers the viewport plus a margin on both sides', () => {
    // The guaranteed slack is `margin - step`, not `margin`: the band is
    // anchored on the bucket the viewport top falls in, so up to one step of it
    // is spent on wherever inside that bucket the scroll happens to be.
    const slack = MOUNT_MARGIN_PX - MOUNT_STEP_PX
    const band = mountBand({ viewportTopPx: 1_000, viewportHeightPx: 600 })
    expect(band.fromPx).toBeLessThanOrEqual(1_000 - slack)
    expect(band.toPx).toBeGreaterThanOrEqual(1_600 + slack)
  })

  it('is QUANTISED, so a scroll frame that moves a few px changes nothing', () => {
    // The whole point. `onScroll` fires ~60 times a second; a band recomputed
    // per frame would re-mount the list per frame, which is the render storm
    // the scroll-offset ref was created to avoid in the first place.
    const a = mountBand({ viewportTopPx: 1_000, viewportHeightPx: 600 })
    const b = mountBand({ viewportTopPx: 1_010, viewportHeightPx: 600 })
    expect(bandsEqual(a, b)).toBe(true)
  })

  it('recomputes a handful of times per SCREEN, not per frame', () => {
    // The bound that matters, stated as the operator would: dragging a whole
    // viewport past the eye must re-select the mounted set a few times — one
    // per step crossed — and never sixty times a second.
    const distinct: MountBand[] = []
    for (let top = 0; top <= 600; top += 1) {
      const band = mountBand({ viewportTopPx: top, viewportHeightPx: 600 })
      if (!distinct.some((seen) => bandsEqual(seen, band))) distinct.push(band)
    }
    expect(distinct.length).toBeLessThanOrEqual(Math.ceil(600 / MOUNT_STEP_PX) + 1)
  })

  it('covers the viewport from EVERY offset inside a bucket', () => {
    // The band is computed from the bucket's top edge, so the viewport can sit
    // up to one step lower than the band assumes. `MOUNT_MARGIN_PX >=
    // MOUNT_STEP_PX` is what absorbs that, and this is the assertion that
    // notices if someone tunes the two apart.
    expect(MOUNT_MARGIN_PX).toBeGreaterThanOrEqual(MOUNT_STEP_PX)
    for (let top = 1_000; top < 1_000 + MOUNT_STEP_PX; top += 7) {
      const band = mountBand({ viewportTopPx: top, viewportHeightPx: 600 })
      expect(band.fromPx, `top ${top}`).toBeLessThanOrEqual(top)
      expect(band.toPx, `top ${top}`).toBeGreaterThanOrEqual(top + 600)
    }
  })

  it('does move once the scroll passes a whole step', () => {
    const a = mountBand({ viewportTopPx: 0, viewportHeightPx: 600 })
    const b = mountBand({ viewportTopPx: MOUNT_STEP_PX * 4, viewportHeightPx: 600 })
    expect(bandsEqual(a, b)).toBe(false)
  })

  it('survives an unmeasured viewport without mounting the whole day', () => {
    const band = mountBand({ viewportTopPx: 0, viewportHeightPx: 0 })
    expect(band.toPx - band.fromPx).toBeLessThan(MOUNT_MARGIN_PX * 2 + MOUNT_STEP_PX * 2 + 1)
  })
})

// ─── selection ────────────────────────────────────────────────────────

describe('itemsInBand', () => {
  const cards = Array.from({ length: 200 }, (_, i) => card(i * 100))

  it('mounts only what the band covers — not the day', () => {
    const band = mountBand({ viewportTopPx: 5_000, viewportHeightPx: 600 })
    const visible = itemsInBand(cards, band)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(cards.length / 4)
    for (const item of visible) {
      expect(item.topPx + item.heightPx).toBeGreaterThanOrEqual(band.fromPx)
      expect(item.topPx).toBeLessThanOrEqual(band.toPx)
    }
  })

  it('keeps a card that only STRADDLES the edge — a half-visible card is visible', () => {
    const band = { fromPx: 1_000, toPx: 2_000 }
    expect(itemsInBand([card(940)], band)).toHaveLength(1)
    expect(itemsInBand([card(2_000)], band)).toHaveLength(1)
    expect(itemsInBand([card(880)], band)).toHaveLength(0)
    expect(itemsInBand([card(2_001)], band)).toHaveLength(0)
  })

  it('returns the SAME array when everything is in band', () => {
    // Identity matters more than the copy: this feeds a memo, and a fresh array
    // per render re-renders every card it holds.
    const few = [card(0), card(100)]
    expect(itemsInBand(few, { fromPx: -1_000, toPx: 10_000 })).toBe(few)
  })

  it('preserves order', () => {
    const band = { fromPx: 0, toPx: 1_000 }
    expect(itemsInBand(cards, band).map((c) => c.topPx)).toEqual(
      [...itemsInBand(cards, band)].map((c) => c.topPx).sort((a, b) => a - b),
    )
  })
})

// ─── ticks ────────────────────────────────────────────────────────────

describe('ticksInBand', () => {
  it('emits only the grid marks the band can show', () => {
    const band = mountBand({ viewportTopPx: 2_000, viewportHeightPx: 600 })
    const ticks = ticksInBand({
      topMs: T0,
      zoomIndex: ZOOM,
      band,
      oldestMs: T0 - 30 * 24 * 3_600_000,
      futurePx: 60,
    })
    expect(ticks.length).toBeGreaterThan(0)
    // Every tick lands inside the band, in the SAME geometry the cards use.
    for (const tick of ticks) {
      const px = epochToOffset(tick, T0, ZOOM)
      expect(px).toBeGreaterThanOrEqual(band.fromPx - 1)
      expect(px).toBeLessThanOrEqual(band.toPx + 1)
    }
  })

  it('never walks a 30-day window to draw one screen', () => {
    // The defect: the generator walked from the live edge to the oldest loaded
    // day on the zoom's grid and handed every mark to the renderer, which then
    // returned null for the ones off screen — 43 000 elements for a screen that
    // shows twenty.
    const band = mountBand({ viewportTopPx: 0, viewportHeightPx: 800 })
    const ticks = ticksInBand({
      topMs: T0,
      zoomIndex: 0,
      band,
      oldestMs: T0 - 30 * 24 * 3_600_000,
      futurePx: 0,
    })
    expect(ticks.length).toBeLessThan(100)
  })

  it('stops at the oldest loaded moment', () => {
    const oldestMs = T0 - 3_600_000
    const band = { fromPx: 0, toPx: pxPerHour(ZOOM) * 24 }
    for (const tick of ticksInBand({ topMs: T0, zoomIndex: ZOOM, band, oldestMs, futurePx: 0 })) {
      expect(tick).toBeGreaterThanOrEqual(oldestMs)
    }
  })

  it('includes the FUTURE band above the live edge', () => {
    const band = { fromPx: -400, toPx: 400 }
    const ticks = ticksInBand({
      topMs: T0,
      zoomIndex: ZOOM,
      band,
      oldestMs: T0 - 86_400_000,
      futurePx: 400,
    })
    expect(ticks.some((t) => t > T0)).toBe(true)
  })
})

// ─── the activity lanes ───────────────────────────────────────────────

describe('bandEpochRange + spansInBand', () => {
  it('keeps only the ranges the band can draw', () => {
    const band = mountBand({ viewportTopPx: 0, viewportHeightPx: 600 })
    const { fromMs, toMs } = bandEpochRange(band, T0, ZOOM)
    const ranges = [
      { startMs: T0 - 60_000, endMs: T0 - 30_000 }, // just under the live edge
      { startMs: T0 - 20 * 3_600_000, endMs: T0 - 19 * 3_600_000 }, // hours away
    ]
    const kept = spansInBand(ranges, fromMs, toMs)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.startMs).toBe(T0 - 60_000)
  })

  it('returns the SAME array when nothing is dropped', () => {
    const ranges = [{ startMs: T0 - 1_000, endMs: T0 }]
    expect(spansInBand(ranges, T0 - 10_000, T0 + 10_000)).toBe(ranges)
  })
})

// ─── the layout anchor: why a live tick moves nothing ─────────────────

describe('layoutAnchorMs', () => {
  it('is stable for every `now` inside the same PIXEL', () => {
    // The live edge advances once a second and every card is positioned from
    // it, so `clusterByZoom` re-ran and re-minted every cluster object once a
    // second — and each of those defeats `ClusterCard`'s memo. At this zoom a
    // pixel is worth several seconds, so a second of wall clock moves nothing
    // that can be seen, and the anchor says so.
    const quantum = msPerPixel(ZOOM)
    expect(quantum).toBeGreaterThan(1_000)
    const anchor = layoutAnchorMs(T0, ZOOM)
    expect(layoutAnchorMs(T0 + 1, ZOOM)).toBe(anchor)
    expect(layoutAnchorMs(T0 + 999, ZOOM)).toBe(anchor)
  })

  it('does move once a whole pixel of time has passed', () => {
    const quantum = msPerPixel(ZOOM)
    expect(layoutAnchorMs(T0 + quantum * 2, ZOOM)).not.toBe(layoutAnchorMs(T0, ZOOM))
  })

  it('never places a card as much as one pixel from where real `now` would', () => {
    // The scrub keeps REAL now (its live-edge tolerance is measured in
    // seconds), so the drawn geometry and the scroll↔time mapping use two
    // anchors. This is the bound that makes that safe.
    for (const zoomIndex of [0, 1, 2, 3]) {
      for (const offsetMs of [0, 1, 500, 999, 60_000, 3_599_999]) {
        const now = T0 + offsetMs
        const epoch = now - 6 * 3_600_000
        const drift = Math.abs(
          epochToOffset(epoch, now, zoomIndex) -
            epochToOffset(epoch, layoutAnchorMs(now, zoomIndex), zoomIndex),
        )
        expect(drift, `zoom ${zoomIndex} at +${offsetMs}ms`).toBeLessThan(1)
      }
    }
  })
})

// ─── the axis swap ────────────────────────────────────────────────────

describe('scrollBand', () => {
  const VIEWPORT = 600
  const SPACER = 60

  it('is the plain band while the offset still exists', () => {
    expect(
      scrollBand({ offsetY: 1_000, contentHeightPx: 20_000, viewportHeightPx: VIEWPORT, topSpacerPx: SPACER }),
    ).toEqual(mountBand({ viewportTopPx: 1_000 - SPACER, viewportHeightPx: VIEWPORT }))
  })

  it('CLAMPS an offset the new content no longer has — the clips toggle', () => {
    // Watching 14:07 on a day of pixels, then the clapperboard: the same list
    // is now 900px tall and the offset is 12 000. A band parked out there
    // selects nothing, and a timeline that renders nothing is not recoverable
    // by scrolling — there is nothing to scroll.
    const band = scrollBand({
      offsetY: 12_000,
      contentHeightPx: 900,
      viewportHeightPx: VIEWPORT,
      topSpacerPx: SPACER,
    })
    const cards = Array.from({ length: 8 }, (_, i) => card(i * 100))
    expect(itemsInBand(cards, band).length).toBeGreaterThan(0)
  })

  it('never goes negative on content shorter than the viewport', () => {
    const band = scrollBand({
      offsetY: 5_000,
      contentHeightPx: 200,
      viewportHeightPx: VIEWPORT,
      topSpacerPx: SPACER,
    })
    expect(itemsInBand([card(0)], band)).toHaveLength(1)
  })
})
