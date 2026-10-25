import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { faceHasInfo, faceInfoByRow, sameFaceReviewRow } from '../face-review-grid.js'
import type { FaceReviewRow } from '../../../data/face-cluster-review.js'

const row: FaceReviewRow = {
  faceId: 'f1',
  deviceId: 1,
  cameraName: 'Gate',
  trackId: 't1',
  timestamp: 1,
  cropUrl: '/c/f1',
  base64: undefined,
  status: 'unassigned',
  assignedIdentityName: undefined,
  suggestedIdentityId: undefined,
  suggestedIdentityName: undefined,
  suggestedMatchScore: undefined,
  certainty: undefined,
}

describe('sameFaceReviewRow', () => {
  it('treats a re-fetched copy as the same row', () => {
    expect(sameFaceReviewRow(row, { ...row })).toBe(true)
  })
  it('sees a changed fact', () => {
    expect(sameFaceReviewRow(row, { ...row, status: 'assigned' })).toBe(false)
  })
})

describe('faceInfoByRow — the info block is decided per row', () => {
  const f = (faceId: string, status: FaceReviewRow['status']) => ({ faceId, status })
  it('a row of unassigned faces has no info block', () => {
    const m = faceInfoByRow([f('a', 'unassigned'), f('b', 'unassigned')], 2)
    expect([m.get('a'), m.get('b')]).toEqual([false, false])
  })
  it('one tile with info keeps the block on every tile of its row', () => {
    const m = faceInfoByRow([f('a', 'unassigned'), f('b', 'suggested')], 2)
    expect([m.get('a'), m.get('b')]).toEqual([true, true])
  })
  it('rows are independent: consecutive runs of `columns`', () => {
    const m = faceInfoByRow(
      [f('a', 'assigned'), f('b', 'unassigned'), f('c', 'unassigned'), f('d', 'unassigned'), f('e', 'unassigned')],
      2,
    )
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => m.get(id))).toEqual([true, true, false, false, false])
  })
  it('a partial last row is judged on the tiles it has', () => {
    const m = faceInfoByRow([f('a', 'unassigned'), f('b', 'unassigned'), f('c', 'assigned')], 2)
    expect([m.get('b'), m.get('c')]).toEqual([false, true])
  })
  it('only an unassigned face has no info; a bad column count is one column', () => {
    expect(faceHasInfo({ status: 'unassigned' })).toBe(false)
    expect(faceHasInfo({ status: 'assigned' })).toBe(true)
    expect(faceInfoByRow([f('a', 'unassigned'), f('b', 'assigned')], 0).get('a')).toBe(false)
  })
})

describe('grid wiring', () => {
  const cell = readFileSync(join(process.cwd(), 'src/components/review/ReviewTile.tsx'), 'utf8')
  const tile = readFileSync(join(process.cwd(), 'src/components/ui/LibraryTile.tsx'), 'utf8')
  it('the cell is the shared Library tile, which never flexes, and its source is memoised', () => {
    expect(cell).toContain('<LibraryTile')
    expect(tile).not.toMatch(/tile: \{\s*flex: 1/)
    expect(cell).toMatch(/useMemo\(\s*\(\) => \(cropUri === null \? null : mediaImageSource\(/)
  })
  it("the time is the events tile's corner chip and formatter, not a line of its own", () => {
    expect(cell).toContain('formatEventTime(')
    expect(cell).toContain('<EventTimeChip')
    expect(cell).not.toContain('captureLabel')
    expect(cell).not.toMatch(/\bwhen=\{/)
  })
})
