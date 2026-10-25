/**
 * The face review tab's SORT, FILTER and SELECTION logic — every one of them
 * client-side, because `faceGallery.listRecentFaces` has no order-by, no time
 * window, and only a SINGLE `deviceId`. See `../face-review-filters.ts`.
 *
 * These are the tests that hold the operator's four asks up: order by
 * certainty and by date, narrow by camera and by date range, and a selection
 * count that cannot claim more than is on screen.
 */
import { describe, it, expect } from 'vitest'
import {
  applyFaceReviewFilters,
  activeFaceReviewFilterCount,
  compareFaceReviewRows,
  faceReviewCameraOptions,
  faceReviewDayBounds,
  faceReviewWindowIsPartial,
  retainSelectedFaces,
  selectedFaceRows,
  setFaceReviewDay,
  setFaceReviewSortKey,
  sortFaceReviewRows,
  toggleFaceReviewDevice,
  toggleFaceReviewSortDirection,
  toggleFaceReviewStatus,
  toggleFaceSelection,
  DEFAULT_FACE_REVIEW_FILTERS,
  DEFAULT_FACE_REVIEW_SORT,
  type FaceReviewFilterState,
  type FaceReviewSort,
} from '../face-review-filters.js'
import { buildFaceReviewRows, type FaceReviewRow } from '../face-cluster-review.js'
import type { PersonIdentity, TrackFace } from '../use-face-gallery.js'

const IDENTITIES: readonly PersonIdentity[] = [
  { id: 'alice', name: 'Alice', sampleCount: 4, coverMediaId: undefined, coverBase64: undefined },
  { id: 'bob', name: 'Bob', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
]
const CAMERA_NAMES: ReadonlyMap<number, string> = new Map([
  [1, 'Front door'],
  [2, 'Garden'],
  [3, 'Cortile'],
])

function face(overrides: Partial<TrackFace> & { readonly faceId: string }): TrackFace {
  return {
    faceId: overrides.faceId,
    deviceId: overrides.deviceId ?? 1,
    trackId: overrides.trackId ?? `t-${overrides.faceId}`,
    timestamp: overrides.timestamp ?? 0,
    assigned: overrides.assigned ?? false,
    identityId: overrides.identityId,
    identityName: overrides.identityName,
    cropUrl: overrides.cropUrl,
    base64: overrides.base64,
    bestMatchScore: overrides.bestMatchScore,
    nativeFaceShortSidePx: overrides.nativeFaceShortSidePx,
    suggestedIdentityId: overrides.suggestedIdentityId,
    suggestedMatchScore: overrides.suggestedMatchScore,
  }
}

function rowsFrom(faces: readonly TrackFace[]): FaceReviewRow[] {
  return buildFaceReviewRows(faces, IDENTITIES, CAMERA_NAMES)
}

/** 2026-08-27 12:00 LOCAL — the range helpers work in local days, so the
 *  fixture is built in local time too rather than from a UTC epoch that would
 *  land on a different day depending on the machine's zone. */
const NOW = new Date(2026, 7, 27, 12, 0, 0, 0).getTime()
const DAY = 86_400_000
const at = (dayOffset: number, hour = 12): number =>
  new Date(2026, 7, 27 - dayOffset, hour, 0, 0, 0).getTime()

// ─────────────────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────────────────

describe('sortFaceReviewRows — by certainty', () => {
  const rows = rowsFrom([
    face({ faceId: 'weak', suggestedIdentityId: 'bob', suggestedMatchScore: 0.4, timestamp: 900 }),
    face({ faceId: 'strong', suggestedIdentityId: 'alice', suggestedMatchScore: 0.95, timestamp: 1 }),
    face({ faceId: 'mid', suggestedIdentityId: 'alice', suggestedMatchScore: 0.7, timestamp: 500 }),
    face({ faceId: 'none', timestamp: 800 }),
  ])
  const desc: FaceReviewSort = { key: 'certainty', direction: 'desc' }
  const asc: FaceReviewSort = { key: 'certainty', direction: 'asc' }

  it('descending puts the best suggestion first — timestamp irrelevant', () => {
    expect(sortFaceReviewRows(rows, desc).map((r) => r.faceId)).toEqual(['strong', 'mid', 'weak', 'none'])
  })

  it('ascending is the exact mirror, unscored rows leading', () => {
    expect(sortFaceReviewRows(rows, asc).map((r) => r.faceId)).toEqual(['none', 'weak', 'mid', 'strong'])
  })

  // ⚠ LOAD-BEARING: a row with NO suggestion has no certainty. Treating it as
  // 0 would file it among genuinely bad matches; it must sit strictly below
  // every real score instead.
  it('an unscored row never outranks even the weakest real suggestion', () => {
    const only = rowsFrom([
      face({ faceId: 'none', timestamp: 5 }),
      face({ faceId: 'awful', suggestedIdentityId: 'bob', suggestedMatchScore: 0, timestamp: 1 }),
    ])
    expect(sortFaceReviewRows(only, desc).map((r) => r.faceId)).toEqual(['awful', 'none'])
  })

  it('does NOT secretly group by status — an assigned row sorts on its own score', () => {
    const mixed = rowsFrom([
      face({ faceId: 'assigned', identityId: 'alice', timestamp: 10 }),
      face({ faceId: 'suggested', suggestedIdentityId: 'bob', suggestedMatchScore: 0.9, timestamp: 1 }),
    ])
    // Status-ranked sorting would have put 'suggested' first regardless of
    // direction. It must not.
    expect(sortFaceReviewRows(mixed, asc).map((r) => r.faceId)).toEqual(['assigned', 'suggested'])
  })
})

describe('sortFaceReviewRows — by date', () => {
  const rows = rowsFrom([
    face({ faceId: 'old', timestamp: 100, suggestedIdentityId: 'alice', suggestedMatchScore: 0.99 }),
    face({ faceId: 'new', timestamp: 900 }),
    face({ faceId: 'mid', timestamp: 500, identityId: 'bob' }),
  ])

  it('descending is newest-first, ACROSS statuses and ignoring certainty', () => {
    expect(sortFaceReviewRows(rows, { key: 'date', direction: 'desc' }).map((r) => r.faceId)).toEqual([
      'new',
      'mid',
      'old',
    ])
  })

  it('ascending is oldest-first', () => {
    expect(sortFaceReviewRows(rows, { key: 'date', direction: 'asc' }).map((r) => r.faceId)).toEqual([
      'old',
      'mid',
      'new',
    ])
  })

  it('is a total order — equal timestamps break on faceId, so a re-sort is stable', () => {
    const tied = rowsFrom([
      face({ faceId: 'b', timestamp: 7 }),
      face({ faceId: 'a', timestamp: 7 }),
      face({ faceId: 'c', timestamp: 7 }),
    ])
    const sort: FaceReviewSort = { key: 'date', direction: 'desc' }
    const once = sortFaceReviewRows(tied, sort).map((r) => r.faceId)
    expect(once).toEqual(['a', 'b', 'c'])
    expect(sortFaceReviewRows(sortFaceReviewRows(tied, sort), sort).map((r) => r.faceId)).toEqual(once)
  })

  it('never mutates the input array', () => {
    const input = rowsFrom([face({ faceId: 'a', timestamp: 1 }), face({ faceId: 'b', timestamp: 2 })])
    const before = input.map((r) => r.faceId)
    sortFaceReviewRows(input, { key: 'date', direction: 'desc' })
    expect(input.map((r) => r.faceId)).toEqual(before)
  })
})

describe('sort state transitions', () => {
  it('flipping direction keeps the key', () => {
    expect(toggleFaceReviewSortDirection({ key: 'certainty', direction: 'desc' })).toEqual({ key: 'certainty', direction: 'asc' })
    expect(DEFAULT_FACE_REVIEW_SORT).toEqual({ key: 'certainty', direction: 'desc' })
    expect(toggleFaceReviewSortDirection({ key: 'date', direction: 'asc' })).toEqual({
      key: 'date',
      direction: 'desc',
    })
  })

  it('changing the key keeps the direction', () => {
    expect(setFaceReviewSortKey({ key: 'certainty', direction: 'asc' }, 'date')).toEqual({
      key: 'date',
      direction: 'asc',
    })
  })

  it('compareFaceReviewRows answers 0 only for the same row', () => {
    const [a, b] = rowsFrom([face({ faceId: 'a', timestamp: 1 }), face({ faceId: 'b', timestamp: 1 })])
    if (a === undefined || b === undefined) throw new Error('fixture')
    expect(compareFaceReviewRows(a, a, DEFAULT_FACE_REVIEW_SORT)).toBe(0)
    expect(compareFaceReviewRows(a, b, DEFAULT_FACE_REVIEW_SORT)).not.toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// The picked day
// ─────────────────────────────────────────────────────────────────────────

/** Local midnight of the day `daysAgo` before NOW. */
const dayStart = (daysAgo: number): number => {
  const d = new Date(NOW)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, 0, 0, 0, 0).getTime()
}

describe('faceReviewDayBounds', () => {
  it('no day is NO bound at all — not a very wide one', () => {
    expect(faceReviewDayBounds(null)).toBeNull()
  })

  it('a day spans exactly its local calendar day, both ends inclusive', () => {
    const bounds = faceReviewDayBounds(dayStart(0))
    expect(bounds?.fromMs).toBe(dayStart(0))
    expect((bounds?.toMs ?? 0) - (bounds?.fromMs ?? 0)).toBe(DAY - 1)
  })

  it('yesterday ends exactly where today begins, with no overlap and no gap', () => {
    expect((faceReviewDayBounds(dayStart(1))?.toMs ?? 0) + 1).toBe(faceReviewDayBounds(dayStart(0))?.fromMs)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────────────

describe('applyFaceReviewFilters', () => {
  const rows = rowsFrom([
    face({ faceId: 'a-today-cam1', identityId: 'alice', deviceId: 1, timestamp: at(0) }),
    face({ faceId: 's-today-cam2', suggestedIdentityId: 'bob', suggestedMatchScore: 0.8, deviceId: 2, timestamp: at(0) }),
    face({ faceId: 'u-yesterday-cam1', deviceId: 1, timestamp: at(1) }),
    face({ faceId: 'u-lastweek-cam3', deviceId: 3, timestamp: at(5) }),
    face({ faceId: 'u-ancient-cam2', deviceId: 2, timestamp: at(90) }),
  ])
  const ids = (state: FaceReviewFilterState): string[] =>
    applyFaceReviewFilters(rows, state).map((r) => r.faceId)
  const ALL: FaceReviewFilterState = { statuses: ['assigned', 'suggested', 'unassigned'], deviceIds: [], dayMs: null }

  it('the default state hides assigned faces and nothing else', () => {
    expect(ids(DEFAULT_FACE_REVIEW_FILTERS)).not.toContain('a-today-cam1')
    expect(ids(DEFAULT_FACE_REVIEW_FILTERS)).toHaveLength(4)
  })

  it('an empty status selection yields NOTHING — not everything', () => {
    expect(ids({ ...ALL, statuses: [] })).toEqual([])
  })

  it('an empty camera selection means EVERY camera', () => {
    expect(ids(ALL)).toHaveLength(5)
  })

  it('narrows to one camera', () => {
    expect(ids({ ...ALL, deviceIds: [1] })).toEqual(['a-today-cam1', 'u-yesterday-cam1'])
  })

  it('narrows to several cameras — the thing the cap\'s single deviceId cannot express', () => {
    expect(ids({ ...ALL, deviceIds: [2, 3] }).sort()).toEqual([
      's-today-cam2',
      'u-ancient-cam2',
      'u-lastweek-cam3',
    ])
  })

  it('narrows to the picked day', () => {
    expect(ids({ ...ALL, dayMs: dayStart(0) }).sort()).toEqual(['a-today-cam1', 's-today-cam2'])
    expect(ids({ ...ALL, dayMs: dayStart(1) })).toEqual(['u-yesterday-cam1'])
    expect(ids({ ...ALL, dayMs: dayStart(90) })).toEqual(['u-ancient-cam2'])
    expect(ids({ ...ALL, dayMs: dayStart(2) })).toEqual([])
  })

  // ⚠ LOAD-BEARING: every predicate is an AND. A filter that ORed would
  // return MORE rows the more the operator narrowed.
  it('camera AND date AND status compose — narrowing twice never widens', () => {
    const both = ids({ statuses: ['unassigned'], deviceIds: [1], dayMs: dayStart(1) })
    expect(both).toEqual(['u-yesterday-cam1'])
    expect(ids({ statuses: ['unassigned'], deviceIds: [2], dayMs: dayStart(1) })).toEqual([])
  })

  it('never mutates the rows it filters', () => {
    const before = rows.map((r) => r.faceId)
    applyFaceReviewFilters(rows, { ...ALL, deviceIds: [1] })
    expect(rows.map((r) => r.faceId)).toEqual(before)
  })
})

describe('filter state transitions', () => {
  it('toggling a status adds then removes it, immutably', () => {
    const on = toggleFaceReviewStatus(DEFAULT_FACE_REVIEW_FILTERS, 'assigned')
    expect(on.statuses).toContain('assigned')
    expect(DEFAULT_FACE_REVIEW_FILTERS.statuses).not.toContain('assigned')
    expect(toggleFaceReviewStatus(on, 'assigned').statuses).toEqual(DEFAULT_FACE_REVIEW_FILTERS.statuses)
  })

  it('toggling a camera adds then removes it', () => {
    const on = toggleFaceReviewDevice(DEFAULT_FACE_REVIEW_FILTERS, 7)
    expect(on.deviceIds).toEqual([7])
    expect(toggleFaceReviewDevice(on, 7).deviceIds).toEqual([])
  })

  it('picking a day leaves the other narrowings alone', () => {
    const state = setFaceReviewDay(toggleFaceReviewDevice(DEFAULT_FACE_REVIEW_FILTERS, 7), dayStart(3))
    expect(state).toEqual({ statuses: DEFAULT_FACE_REVIEW_FILTERS.statuses, deviceIds: [7], dayMs: dayStart(3) })
    expect(setFaceReviewDay(state, null).dayMs).toBeNull()
  })

  it('counts only narrowings ON TOP of the default', () => {
    expect(activeFaceReviewFilterCount(DEFAULT_FACE_REVIEW_FILTERS)).toBe(0)
    expect(activeFaceReviewFilterCount({ ...DEFAULT_FACE_REVIEW_FILTERS, dayMs: dayStart(0) })).toBe(1)
    expect(
      activeFaceReviewFilterCount({ statuses: ['assigned'], deviceIds: [1], dayMs: dayStart(0) }),
    ).toBe(3)
  })

  it('the default statuses in a different ORDER are still the default', () => {
    expect(activeFaceReviewFilterCount({ ...DEFAULT_FACE_REVIEW_FILTERS, statuses: ['unassigned', 'suggested'] })).toBe(0)
  })
})

describe('faceReviewWindowIsPartial — only the client-side status cut has to admit its scope', () => {
  it('is false when the hub has handed over everything', () => {
    expect(faceReviewWindowIsPartial({ ...DEFAULT_FACE_REVIEW_FILTERS, statuses: ['suggested'] }, false)).toBe(false)
  })

  it('is false for the default chips: the hub filter IS that set', () => {
    expect(faceReviewWindowIsPartial(DEFAULT_FACE_REVIEW_FILTERS, true)).toBe(false)
  })

  it('is false for a camera or a date, which the hub now applies before the limit', () => {
    expect(faceReviewWindowIsPartial({ ...DEFAULT_FACE_REVIEW_FILTERS, dayMs: dayStart(20) }, true)).toBe(false)
    expect(faceReviewWindowIsPartial({ ...DEFAULT_FACE_REVIEW_FILTERS, deviceIds: [1] }, true)).toBe(false)
  })

  it('is TRUE for one chip inside the hub set while the window is still growing', () => {
    expect(faceReviewWindowIsPartial({ ...DEFAULT_FACE_REVIEW_FILTERS, statuses: ['suggested'] }, true)).toBe(true)
  })
})

describe('faceReviewCameraOptions', () => {
  it('lists each camera present in the rows once, by name', () => {
    const rows = rowsFrom([
      face({ faceId: 'a', deviceId: 2 }),
      face({ faceId: 'b', deviceId: 1 }),
      face({ faceId: 'c', deviceId: 1 }),
    ])
    expect(faceReviewCameraOptions(rows)).toEqual([
      { deviceId: 1, name: 'Front door' },
      { deviceId: 2, name: 'Garden' },
    ])
  })

  it('keeps a camera the device list could not name, under its id', () => {
    const rows = rowsFrom([face({ faceId: 'a', deviceId: 102 })])
    expect(faceReviewCameraOptions(rows)).toEqual([{ deviceId: 102, name: '#102' }])
  })

  it('is empty when there are no rows — the screen renders the hint instead', () => {
    expect(faceReviewCameraOptions([])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Multi-selection
// ─────────────────────────────────────────────────────────────────────────

describe('multi-selection', () => {
  const rows = rowsFrom([
    face({ faceId: 'f1', deviceId: 1 }),
    face({ faceId: 'f2', deviceId: 1 }),
    face({ faceId: 'f3', deviceId: 2 }),
  ])

  it('toggling adds then removes, never mutating the previous set', () => {
    const empty: ReadonlySet<string> = new Set()
    const one = toggleFaceSelection(empty, 'f1')
    expect(one.size).toBe(1)
    expect(empty.size).toBe(0)
    const two = toggleFaceSelection(one, 'f2')
    expect(two.size).toBe(2)
    expect(one.size).toBe(1)
    expect(toggleFaceSelection(two, 'f1').size).toBe(1)
  })

  // ⚠ LOAD-BEARING: this is the count the selection bar shows and the set the
  // Assign button writes. A selected face that scrolled out of the filter
  // would make "3 selected" point at 2 visible crops AND write to a face the
  // operator can no longer see.
  it('drops a selected face that is no longer among the visible rows', () => {
    const selected = new Set(['f1', 'f3', 'ghost'])
    const kept = retainSelectedFaces(selected, rows.filter((r) => r.deviceId === 1))
    expect([...kept]).toEqual(['f1'])
  })

  it('returns the SAME set instance when nothing was dropped — the screen memoises on it', () => {
    const selected: ReadonlySet<string> = new Set(['f1', 'f2'])
    expect(retainSelectedFaces(selected, rows)).toBe(selected)
  })

  it('an empty selection is returned untouched', () => {
    const empty: ReadonlySet<string> = new Set()
    expect(retainSelectedFaces(empty, [])).toBe(empty)
  })

  it('resolves the selection in the order the rows are DISPLAYED, not set order', () => {
    const selected = new Set(['f3', 'f1'])
    expect(selectedFaceRows(rows, selected).map((r) => r.faceId)).toEqual(['f1', 'f3'])
  })

  it('the carousel pages follow the current SORT', () => {
    const byDateAsc = sortFaceReviewRows(
      rowsFrom([
        face({ faceId: 'x', timestamp: 300 }),
        face({ faceId: 'y', timestamp: 100 }),
        face({ faceId: 'z', timestamp: 200 }),
      ]),
      { key: 'date', direction: 'asc' },
    )
    expect(selectedFaceRows(byDateAsc, new Set(['x', 'y'])).map((r) => r.faceId)).toEqual(['y', 'x'])
  })

  it('selecting a face that is not on screen yields nothing to write', () => {
    expect(selectedFaceRows(rows, new Set(['ghost']))).toEqual([])
  })
})
