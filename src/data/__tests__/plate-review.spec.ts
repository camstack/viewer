import { describe, it, expect } from 'vitest'

import {
  buildPlateReviewRows,
  filterVehicles,
  normalizePlateText,
  plateDeletionReadiness,
  plateSuggestionReadiness,
  toPlateCluster,
  toPlateInfo,
  type PlateInfo,
  type PlateVehicle,
} from '../plate-review.js'
import {
  applyPlateReviewFilters,
  plateReviewCameraOptions,
  plateReviewWindowIsPartial,
  retainSelectedPlates,
  sortPlateReviewRows,
} from '../plate-review-filters.js'
import { DEFAULT_FACE_REVIEW_FILTERS } from '../face-review-filters.js'

function plate(over: Partial<PlateInfo> & { plateId: string }): PlateInfo {
  return {
    deviceId: 1,
    trackId: `t-${over.plateId}`,
    timestamp: 1_000,
    text: 'AB123CD',
    score: 0.9,
    corrected: false,
    assigned: false,
    recognizedVehicleId: undefined,
    vehicleName: undefined,
    cropUrl: undefined,
    base64: undefined,
    ...over,
  }
}

const VEHICLES: readonly PlateVehicle[] = [
  { id: 'v1', name: 'Fiat Panda', sampleCount: 3, coverMediaId: undefined },
  { id: 'v2', name: 'Citroën C3', sampleCount: 1, coverMediaId: undefined },
]
const CAMERAS = new Map([[1, 'Gate'], [2, 'Drive']])

const ROWS = buildPlateReviewRows(
  [
    plate({ plateId: 'a', assigned: true, recognizedVehicleId: 'v1' }),
    plate({ plateId: 'b', recognizedVehicleId: 'v1', timestamp: 3_000, score: 0.5 }),
    plate({ plateId: 'c', recognizedVehicleId: 'v2', deviceId: 2, timestamp: 2_000, score: 0.7 }),
    plate({ plateId: 'd', timestamp: 4_000, score: 0.95 }),
  ],
  VEHICLES,
  CAMERAS,
)
const byId = (id: string) => ROWS.find((r) => r.plateId === id)!

describe('plate status', () => {
  it('derives assigned / suggested / unassigned from what the read carries', () => {
    expect(ROWS.map((r) => r.status)).toEqual(['assigned', 'suggested', 'suggested', 'unassigned'])
  })
  it('names the vehicle from the list when the row has no name, and none for an unassigned read', () => {
    expect(byId('b').vehicleName).toBe('Fiat Panda')
    expect(byId('d').vehicleId).toBeUndefined()
    expect(byId('d').vehicleName).toBeUndefined()
  })
  it('carries the camera name', () => {
    expect(byId('c').cameraName).toBe('Drive')
  })
})

describe('narrowing the wire', () => {
  it('rejects a row without an id and keeps a minimal one', () => {
    expect(toPlateInfo({ deviceId: 1, trackId: 't' })).toBeNull()
    expect(toPlateInfo({ plateId: 'p', deviceId: 1, trackId: 't', text: 'X' })?.assigned).toBe(false)
  })
  it('drops a cluster of fewer than two reads', () => {
    expect(toPlateCluster({ plateIds: ['a'], representativePlateId: 'a' })).toBeNull()
    expect(toPlateCluster({ plateIds: ['a', 'b'], representativePlateId: 'a', representativeText: 'X' })?.size).toBe(2)
  })
})

describe('filters', () => {
  it('defaults to suggested + unassigned', () => {
    expect(applyPlateReviewFilters(ROWS, DEFAULT_FACE_REVIEW_FILTERS).map((r) => r.plateId)).toEqual(['b', 'c', 'd'])
  })
  it('empty status chips yield nothing, and cameras AND with status', () => {
    expect(applyPlateReviewFilters(ROWS, { ...DEFAULT_FACE_REVIEW_FILTERS, statuses: [] })).toEqual([])
    expect(
      applyPlateReviewFilters(ROWS, { ...DEFAULT_FACE_REVIEW_FILTERS, deviceIds: [2] }).map((r) => r.plateId),
    ).toEqual(['c'])
  })
  it('sorts by read confidence and by date, either direction, with a stable tie-break', () => {
    expect(sortPlateReviewRows(ROWS, { key: 'certainty', direction: 'desc' }).map((r) => r.plateId)).toEqual(['d', 'a', 'c', 'b'])
    expect(sortPlateReviewRows(ROWS, { key: 'date', direction: 'asc' }).map((r) => r.plateId)).toEqual(['a', 'c', 'b', 'd'])
  })
  it('lists cameras from the loaded rows, by name', () => {
    expect(plateReviewCameraOptions(ROWS).map((c) => c.name)).toEqual(['Drive', 'Gate'])
  })
  it('says the window is partial only when the app cuts it and more exist', () => {
    expect(plateReviewWindowIsPartial(DEFAULT_FACE_REVIEW_FILTERS, false)).toBe(false)
    expect(plateReviewWindowIsPartial(DEFAULT_FACE_REVIEW_FILTERS, true)).toBe(true)
    expect(
      plateReviewWindowIsPartial({ statuses: ['assigned', 'suggested', 'unassigned'], deviceIds: [1], dayMs: null }, true),
    ).toBe(false)
  })
  it('keeps the SAME selection set when nothing was dropped', () => {
    const sel = new Set(['a', 'b'])
    expect(retainSelectedPlates(sel, ROWS)).toBe(sel)
    expect([...retainSelectedPlates(new Set(['a', 'zzz']), ROWS)]).toEqual(['a'])
  })
})

describe('selection writes', () => {
  it('applies suggestions all-or-nothing, grouped by vehicle', () => {
    const ready = plateSuggestionReadiness([byId('b'), byId('c'), { ...byId('b'), plateId: 'b2' }])
    expect(ready.ready).toBe(true)
    expect(ready.plan).toEqual([
      { vehicleId: 'v1', name: 'Fiat Panda', plateIds: ['b', 'b2'] },
      { vehicleId: 'v2', name: 'Citroën C3', plateIds: ['c'] },
    ])
    const blocked = plateSuggestionReadiness([byId('b'), byId('d')])
    expect(blocked).toMatchObject({ ready: false, missing: 1, plan: [] })
  })
  it('deletes only reads that belong to no vehicle', () => {
    expect(plateDeletionReadiness([byId('b'), byId('d')])).toMatchObject({ ready: true, plateIds: ['b', 'd'] })
    expect(plateDeletionReadiness([byId('a'), byId('d')])).toMatchObject({ ready: false, blocked: 1, plateIds: [] })
  })
})

describe('text helpers', () => {
  it('searches vehicles accent- and case-insensitively', () => {
    expect(filterVehicles(VEHICLES, 'citro').map((v) => v.id)).toEqual(['v2'])
    expect(filterVehicles(VEHICLES, '  ')).toBe(VEHICLES)
  })
  it('normalises plate text like the hub stores it', () => {
    expect(normalizePlateText('ab 123-cd')).toBe('AB123CD')
  })
})
