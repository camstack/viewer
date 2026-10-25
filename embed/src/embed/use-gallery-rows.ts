/**
 * use-gallery-rows — the MEASURED half of gallery virtualization.
 *
 * `events-reel-window.ts` decides which rows to render from a set of row
 * heights; this hook is where those heights come from, and it exists because
 * the gallery tile is **not a uniform height**. Its hero is square, but under
 * it: a caption line only some rows have, a camera name that clamps at one OR
 * two 15 px lines, and an optional zone chip. Two rows of the same feed differ
 * by up to ~30 px, and a fixed-stride window over them drifts by a whole row
 * every twenty — the list would scroll past its own end.
 *
 * So a rendered row is measured and remembered; a row nobody has seen yet is
 * the running average of the ones who have.
 *
 * Heights are keyed by ROW INDEX, not by the row's identity. Appending pages
 * (what infinite scroll does) only adds higher indices, so every measurement
 * above stays valid and the visible rows do not move. A PREPEND — the
 * incremental refresh folding in newer rows — re-assigns indices, and the
 * heights then describe the wrong rows until they are re-measured; the error is
 * bounded by the ~30 px spread above and corrects on the next layout pass.
 * Keying by identity would have been exact for that one case and would have
 * thrown away every measurement on a column change, which happens on every
 * rotation.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  estimateGalleryRowPx,
  galleryVirtualWindow,
  type GalleryVirtualWindow,
} from '../../../shared/events/events-reel-window'

export interface GalleryRowsParams {
  /** Grid rows in the whole list — `ceil(items / columns)`. */
  readonly rowCount: number
  readonly scrollTop: number
  /** The scroller's own height, CSS px. 0 ⇒ unmeasured; nothing is windowed. */
  readonly viewportHeight: number
  /** Height to assume before anything has been measured (`rowStridePx`). */
  readonly fallbackRowPx: number
  /**
   * Everything that changes what a row is WORTH in pixels — the column count,
   * the card width, which fields render. When it changes, every stored height
   * describes a layout that no longer exists and the whole map is dropped.
   */
  readonly geometryKey: string
}

export interface GalleryRowsResult {
  readonly window: GalleryVirtualWindow
  /** Ref callback for the row container at `index`. Stable per index. */
  readonly measureRow: (index: number) => (element: HTMLElement | null) => void
}

export function useGalleryRows(params: GalleryRowsParams): GalleryRowsResult {
  const { rowCount, scrollTop, viewportHeight, fallbackRowPx, geometryKey } = params
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map())
  const refCallbacksRef = useRef<Map<number, (element: HTMLElement | null) => void>>(new Map())
  /** The heights, as STATE and replaced whole rather than mutated: the window
   *  is computed during render from them, and a map render could not see
   *  change would leave the spacers describing the previous layout. */
  const [measuredPx, setMeasuredPx] = useState<ReadonlyMap<number, number>>(
    () => new Map<number, number>(),
  )

  const geometryRef = useRef(geometryKey)
  useEffect(() => {
    if (geometryRef.current === geometryKey) return
    geometryRef.current = geometryKey
    refCallbacksRef.current = new Map()
    setMeasuredPx(new Map<number, number>())
  }, [geometryKey])

  const measureRow = useCallback((index: number): ((element: HTMLElement | null) => void) => {
    const existing = refCallbacksRef.current.get(index)
    if (existing !== undefined) return existing
    // One stable callback per index: a fresh closure per render would make
    // React detach and re-attach every row's ref on every scroll frame.
    const callback = (element: HTMLElement | null): void => {
      if (element === null) elementsRef.current.delete(index)
      else elementsRef.current.set(index, element)
    }
    refCallbacksRef.current.set(index, callback)
    return callback
  }, [])

  // After EVERY commit: the rows mounted right now are the only ones that can
  // be measured, and which ones those are changes with every scroll.
  useLayoutEffect(() => {
    let next: Map<number, number> | null = null
    for (const [index, element] of elementsRef.current) {
      const height = Math.round(element.getBoundingClientRect().height)
      // 0 is "no layout" (jsdom, a hidden host), never "a row of no height".
      // Storing it would collapse the scroller to nothing.
      if (height <= 0) continue
      if (measuredPx.get(index) === height) continue
      next ??= new Map(measuredPx)
      next.set(index, height)
    }
    // Only when something actually moved — an unconditional set here is an
    // infinite render loop, and the reason this reads before it writes.
    if (next !== null) setMeasuredPx(next)
  })

  const window = useMemo(
    () =>
      galleryVirtualWindow({
        rowCount,
        scrollTop,
        viewportHeight,
        estimatedRowPx: estimateGalleryRowPx(measuredPx, fallbackRowPx),
        measuredPx,
      }),
    [rowCount, scrollTop, viewportHeight, fallbackRowPx, measuredPx],
  )

  return { window, measureRow }
}
