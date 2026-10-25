import { describe, expect, it } from 'vitest'
import {
  GALLERY_PRELOAD_MAX_ITEMS,
  galleryGeometry,
  galleryPreloadWindow,
  galleryVirtualWindow,
  type GalleryGeometryMetrics,
  type GalleryVirtualWindow,
} from '../events-reel-window'

/**
 * The gallery's half of the viewport policy — which did not exist.
 *
 * `use-image-preloader`'s docblock claimed the surface never recreates "the
 * 60-concurrent stampede", and the reel honoured that through
 * `reelPreloadWindow`. The gallery passed `rows` — the WHOLE feed — straight
 * into the preloader, so opening Events queued every tile of every loaded page
 * at once. A leftover that describes the right design is worse than nothing:
 * it read as verification for two months.
 *
 * The cards' own `useInViewport` was never the problem (it loads a screen plus
 * one). This is the background half, and it must be a WINDOW.
 *
 * Since virtualization it is the SAME window: the preload band is derived from
 * the rendered row window rather than from a second scroll→row estimate of its
 * own. That is what these tests now drive — geometry, then rows, then images,
 * in the one order the page runs them.
 */

const METRICS: GalleryGeometryMetrics = {
  viewportWidth: 400,
  cardWidth: 160,
  gap: 8,
}

const rows = Array.from({ length: 200 }, (_, i) => i)

/** Compose exactly what the page composes: geometry → row window. */
function windowFor(
  metrics: GalleryGeometryMetrics,
  scrollTop: number,
  viewportHeight: number,
  itemCount = rows.length,
): { readonly window: GalleryVirtualWindow; readonly columns: number } {
  const geometry = galleryGeometry(metrics)
  return {
    columns: geometry.columns,
    window: galleryVirtualWindow({
      rowCount: Math.ceil(itemCount / geometry.columns),
      scrollTop,
      viewportHeight,
      estimatedRowPx: geometry.rowStridePx,
      measuredPx: new Map<number, number>(),
    }),
  }
}

describe('galleryPreloadWindow', () => {
  it('warms a couple of screens, NOT the whole feed', () => {
    const { window, columns } = windowFor(METRICS, 0, 700)
    const win = galleryPreloadWindow(rows, window, columns)
    // 400px wide / 160px cards → 2 columns. ~700px tall, cards ~2xx px each →
    // a handful of rows on screen, plus the overscan and the rows ahead.
    expect(win.length).toBeLessThan(30)
    expect(win.length).toBeGreaterThanOrEqual(4)
  })

  it('is hard-capped, whatever the geometry claims', () => {
    // The row window follows the viewport, and a viewport can be absurd. The
    // cap is what makes the bound a fact rather than a calculation.
    const { window, columns } = windowFor(METRICS, 0, 100_000)
    expect(galleryPreloadWindow(rows, window, columns).length).toBeLessThanOrEqual(
      GALLERY_PRELOAD_MAX_ITEMS,
    )
  })

  it('follows the scroll instead of re-warming the top', () => {
    const deep = windowFor(METRICS, 4_000, 700)
    const top = windowFor(METRICS, 0, 700)
    const scrolled = galleryPreloadWindow(rows, deep.window, deep.columns)
    const first = galleryPreloadWindow(rows, top.window, top.columns)
    expect(scrolled[0]).toBeGreaterThan(first[0] ?? 0)
    expect(scrolled.length).toBeLessThanOrEqual(GALLERY_PRELOAD_MAX_ITEMS)
  })

  it('starts on a ROW boundary — a grid fills left to right', () => {
    // 2 columns: the window must never begin mid-row, or the tile beside the
    // first warmed one is left to fetch on its own.
    const { window, columns } = windowFor(METRICS, 4_000, 700)
    const win = galleryPreloadWindow(rows, window, columns)
    expect((win[0] ?? 0) % 2).toBe(0)
  })

  it('degrades to a bounded head when nothing has been measured yet', () => {
    // First paint: clientWidth/clientHeight are 0. The row window refuses to
    // hide rows it cannot prove are off-screen and returns the whole list;
    // the preload cap is what keeps that from being the stampede again.
    const { window, columns } = windowFor({ ...METRICS, viewportWidth: 0 }, 0, 0)
    const win = galleryPreloadWindow(rows, window, columns)
    expect(win.length).toBeGreaterThan(0)
    expect(win.length).toBeLessThanOrEqual(GALLERY_PRELOAD_MAX_ITEMS)
  })

  it('never invents rows it does not have', () => {
    const short = windowFor(METRICS, 0, 700, 3)
    expect(galleryPreloadWindow([1, 2, 3], short.window, short.columns)).toEqual([1, 2, 3])
    expect(galleryPreloadWindow([], short.window, short.columns)).toEqual([])
  })
})

describe('galleryGeometry — one authority for the column count', () => {
  it('reproduces what `repeat(auto-fill, minmax(w, 1fr))` would have done', () => {
    // 400 + 8 gap, over a 160 + 8 track → 2 columns, 196 px each.
    const geometry = galleryGeometry(METRICS)
    expect(geometry.columns).toBe(2)
    expect(geometry.columnWidth).toBe(196)
  })

  it('honours an explicit column count from the host', () => {
    expect(galleryGeometry({ ...METRICS, columns: 4 }).columns).toBe(4)
  })

  it('never returns zero columns for an unmeasured scroller', () => {
    // A zero column count divides the row chunking by zero.
    expect(galleryGeometry({ ...METRICS, viewportWidth: 0 }).columns).toBe(1)
  })
})
