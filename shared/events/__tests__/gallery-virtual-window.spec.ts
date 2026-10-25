import { describe, expect, it } from 'vitest'
import {
  estimateGalleryRowPx,
  GALLERY_OVERSCAN_ROWS,
  galleryVirtualWindow,
  type GalleryVirtualMetrics,
} from '../events-reel-window'

/**
 * The row window that removed the 600-row ceiling.
 *
 * `DEFAULT_EVENTS_MAX_ROWS` was never a memory bound — it was a DOM bound: the
 * gallery mounted a `<button>`, an image, its chips and its viewport observer
 * for every row it held, so the client had to stop somewhere and the operator
 * met a wall a few hours into the day. Windowing the rows is what moved the
 * bound from the DOM to what is retained.
 *
 * Two things it must never trade away for that:
 *   1. the scroller's height, which has to describe the WHOLE list — a
 *      virtualized list with a lying scrollbar is worse than an unwindowed one;
 *   2. the rows already on screen, which must not move when a page lands.
 */

const BASE: GalleryVirtualMetrics = {
  rowCount: 500,
  scrollTop: 0,
  viewportHeight: 700,
  estimatedRowPx: 200,
  measuredPx: new Map<number, number>(),
}

describe('galleryVirtualWindow', () => {
  it('renders a SLICE of a long list, not the list', () => {
    const win = galleryVirtualWindow(BASE)
    // 700 px over 200 px rows = 4 visible, plus the overscan on both ends.
    expect(win.endRow - win.startRow).toBe(4 + GALLERY_OVERSCAN_ROWS)
    expect(win.endRow).toBeLessThan(BASE.rowCount)
  })

  it('keeps the scroller honest: the pads carry everything NOT rendered', () => {
    const win = galleryVirtualWindow(BASE)
    expect(win.totalPx).toBe(500 * 200)
    const rendered = (win.endRow - win.startRow) * 200
    expect(win.padTopPx + rendered + win.padBottomPx).toBe(win.totalPx)
  })

  it('follows the scroll, and the pad above is EXACTLY the rows above', () => {
    const win = galleryVirtualWindow({ ...BASE, scrollTop: 4_000 })
    // Row 20 is the first one the viewport touches; the overscan renders two
    // more above it, and the pad has to shrink by exactly those two.
    expect(win.startRow).toBe(20 - GALLERY_OVERSCAN_ROWS)
    expect(win.padTopPx).toBe((20 - GALLERY_OVERSCAN_ROWS) * 200)
    expect(win.padTopPx + (win.endRow - win.startRow) * 200 + win.padBottomPx).toBe(win.totalPx)
  })

  it('appending rows moves NOTHING that is already on screen', () => {
    // The one behaviour a windowed infinite list is most likely to get wrong.
    // Heights are keyed by row INDEX, so a page landing at the bottom cannot
    // touch the offset of anything above it.
    const before = galleryVirtualWindow({ ...BASE, scrollTop: 4_000 })
    const after = galleryVirtualWindow({ ...BASE, scrollTop: 4_000, rowCount: 800 })
    expect(after.startRow).toBe(before.startRow)
    expect(after.endRow).toBe(before.endRow)
    expect(after.padTopPx).toBe(before.padTopPx)
    // …and the scrollbar grew by exactly the rows that arrived.
    expect(after.totalPx - before.totalPx).toBe(300 * 200)
  })

  it('a MEASURED row beats the estimate — the gallery tile is not uniform', () => {
    // The hero is square, but the caption line is optional, the camera name
    // clamps at one OR two lines and a zone chip adds another. A fixed stride
    // over that drifts a whole row every twenty.
    const measuredPx = new Map<number, number>([
      [0, 260],
      [1, 260],
      [2, 260],
    ])
    const win = galleryVirtualWindow({ ...BASE, rowCount: 10, measuredPx })
    expect(win.totalPx).toBe(3 * 260 + 7 * 200)
  })

  it('a zero measurement is "no layout", never "a row of no height"', () => {
    // jsdom, and a host rendering the embed hidden, both report 0. Believing
    // it would collapse the scroller to nothing.
    const measuredPx = new Map<number, number>([[0, 0]])
    expect(galleryVirtualWindow({ ...BASE, rowCount: 10, measuredPx }).totalPx).toBe(10 * 200)
  })

  it('an UNMEASURED scroller is not windowed at all', () => {
    // A window computed from a viewport of unknown size would hide rows it
    // cannot prove are off-screen.
    const win = galleryVirtualWindow({ ...BASE, rowCount: 40, viewportHeight: 0 })
    expect(win.startRow).toBe(0)
    expect(win.endRow).toBe(40)
    expect(win.padTopPx).toBe(0)
    expect(win.padBottomPx).toBe(0)
  })

  it('an empty list has no window and no height', () => {
    const win = galleryVirtualWindow({ ...BASE, rowCount: 0 })
    expect(win).toEqual({ startRow: 0, endRow: 0, padTopPx: 0, padBottomPx: 0, totalPx: 0 })
  })

  it('a scroll past the end still renders the last row', () => {
    const win = galleryVirtualWindow({ ...BASE, rowCount: 10, scrollTop: 900_000 })
    expect(win.endRow).toBe(10)
    expect(win.startRow).toBeLessThan(10)
  })
})

describe('estimateGalleryRowPx', () => {
  it('falls back to the geometric estimate until something has been measured', () => {
    expect(estimateGalleryRowPx(new Map<number, number>(), 176)).toBe(176)
  })

  it('averages what HAS been measured, so the scrollbar converges', () => {
    const measured = new Map<number, number>([
      [0, 200],
      [1, 240],
      [2, 0],
    ])
    expect(estimateGalleryRowPx(measured, 176)).toBe(220)
  })
})
