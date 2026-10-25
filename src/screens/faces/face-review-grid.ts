/**
 * face-review-grid — pure identity helpers of the People grid, RN-free so they
 * are unit testable. Its geometry (columns, tile width) is the Library-wide
 * rule in `components/ui/library-grid.ts`.
 */
import type { FaceReviewRow } from '../../data/face-cluster-review.js'

/**
 * Field-by-field equality of two rows. A page load re-fetches the WHOLE window
 * (the hub has no cursor), so every row arrives as a new object holding the
 * same facts; comparing by value keeps the memoised cells from re-rendering.
 */
export function sameFaceReviewRow(a: FaceReviewRow, b: FaceReviewRow): boolean {
  if (a === b) return true
  const keys = Object.keys(a) as (keyof FaceReviewRow)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => a[k] === b[k])
}

/** A face carries the info block (name, certainty, Confirm) unless nothing is known about it. */
export function faceHasInfo(row: Pick<FaceReviewRow, 'status'>): boolean {
  return row.status !== 'unassigned'
}

/**
 * Which faces draw the info block under their image, decided PER ROW of the
 * grid: a row where no tile has anything to say has no block (a shorter row);
 * a row where at least one does keeps it on every tile so the row is one height.
 * Rows are consecutive runs of `columns` items, as the list lays them out.
 */
export function faceInfoByRow(rows: readonly Pick<FaceReviewRow, 'faceId' | 'status'>[], columns: number): ReadonlyMap<string, boolean> {
  const size = Math.max(1, Math.floor(columns))
  const out = new Map<string, boolean>()
  for (let start = 0; start < rows.length; start += size) {
    const line = rows.slice(start, start + size)
    const show = line.some(faceHasInfo)
    for (const r of line) out.set(r.faceId, show)
  }
  return out
}
