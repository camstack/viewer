import { describe, it, expect } from 'vitest'
import { buildListArtifactsInput, NC_GALLERY_ARTIFACT_KINDS } from '../../../data/nc-artifacts.js'
import {
  ARTIFACT_KIND_ORDER,
  ARTIFACT_RANGE_BUCKET_MS,
  EMPTY_ARTIFACT_FILTERS,
  activeArtifactFilterCount,
  artifactDayBounds,
  bucketArtifactNow,
  clearArtifactFilters,
  setArtifactDayOffset,
  toArtifactFilters,
  toggleArtifactDevice,
  toggleArtifactKind,
} from '../artifact-filters.js'

const NOW = Date.UTC(2026, 7, 16, 18, 0, 0)
const DAY = 86_400_000

describe('the catalog is the gallery, not the posters', () => {
  it('offers every gallery kind the operator can filter by', () => {
    expect([...ARTIFACT_KIND_ORDER]).toEqual([...NC_GALLERY_ARTIFACT_KINDS])
  })

  it('does not offer a chip for the timelapse thumbnail or the still', () => {
    expect(ARTIFACT_KIND_ORDER).not.toContain('timelapse-preview')
    expect(ARTIFACT_KIND_ORDER).not.toContain('event-still')
  })

  it('offers gif and mp4 as first-class gallery kinds', () => {
    expect(ARTIFACT_KIND_ORDER).toContain('event-gif')
    expect(ARTIFACT_KIND_ORDER).toContain('event-clip')
  })
})

describe('artifactDayBounds — local calendar day under the cursor', () => {
  it('today is midnight..end of today', () => {
    const { fromMs, toMs } = artifactDayBounds(0, NOW)
    expect(toMs - fromMs).toBe(DAY - 1)
    const start = new Date(NOW)
    start.setHours(0, 0, 0, 0)
    expect(fromMs).toBe(start.getTime())
  })

  it('offset 1 is yesterday, not a rolling 24h', () => {
    const today = artifactDayBounds(0, NOW)
    const yesterday = artifactDayBounds(1, NOW)
    expect(yesterday.toMs + 1).toBe(today.fromMs)
    expect(yesterday.fromMs).toBe(today.fromMs - DAY)
  })
})

describe('toArtifactFilters — state → wire filters', () => {
  it('sends the day window even for the untouched gallery', () => {
    const { fromMs, toMs } = artifactDayBounds(0, NOW)
    expect(toArtifactFilters(EMPTY_ARTIFACT_FILTERS, NOW)).toEqual({ fromMs, toMs })
  })

  it('omits an emptied kind selection instead of sending []', () => {
    const emptied = toggleArtifactKind(toggleArtifactKind(EMPTY_ARTIFACT_FILTERS, 'timelapse'), 'timelapse')
    expect(toArtifactFilters(emptied, NOW).kinds).toBeUndefined()
  })

  it('reaches the wire input with the selections intact', () => {
    const state = setArtifactDayOffset(
      toggleArtifactDevice(toggleArtifactKind(EMPTY_ARTIFACT_FILTERS, 'event-gif'), 102),
      1,
    )
    const { fromMs, toMs } = artifactDayBounds(1, NOW)
    expect(buildListArtifactsInput(toArtifactFilters(state, NOW), { limit: 50, offset: 0 })).toEqual({
      kinds: ['event-gif'],
      deviceIds: [102],
      fromMs,
      toMs,
      limit: 50,
      offset: 0,
    })
  })
})

describe('transitions are immutable', () => {
  it('toggling a kind never mutates the previous state', () => {
    const before = EMPTY_ARTIFACT_FILTERS
    const after = toggleArtifactKind(before, 'timelapse')
    expect(before.kinds).toEqual([])
    expect(after.kinds).toEqual(['timelapse'])
    expect(toggleArtifactKind(after, 'timelapse').kinds).toEqual([])
  })

  it('toggling a device never mutates the previous state', () => {
    const before = toggleArtifactDevice(EMPTY_ARTIFACT_FILTERS, 101)
    const after = toggleArtifactDevice(before, 102)
    expect(before.deviceIds).toEqual([101])
    expect(after.deviceIds).toEqual([101, 102])
    expect(toggleArtifactDevice(after, 101).deviceIds).toEqual([102])
  })

  it('setting a day offset preserves the other selections', () => {
    const state = setArtifactDayOffset(toggleArtifactKind(EMPTY_ARTIFACT_FILTERS, 'event-clip'), 3)
    expect(state.kinds).toEqual(['event-clip'])
    expect(state.dayOffset).toBe(3)
  })

  it('clear returns the empty state', () => {
    expect(clearArtifactFilters()).toEqual(EMPTY_ARTIFACT_FILTERS)
  })
})

describe('activeArtifactFilterCount', () => {
  it('counts kind and camera once, and the day cursor as none', () => {
    expect(activeArtifactFilterCount(EMPTY_ARTIFACT_FILTERS)).toBe(0)
    expect(
      activeArtifactFilterCount({ kinds: ['timelapse', 'event-gif'], deviceIds: [], dayOffset: 4 }),
    ).toBe(1)
    expect(
      activeArtifactFilterCount({ kinds: ['timelapse'], deviceIds: [102], dayOffset: 0 }),
    ).toBe(2)
  })
})

describe('bucketArtifactNow', () => {
  it('snaps to the bucket grid so fromMs is stable across renders', () => {
    const base = 1_700_000_000_000 - (1_700_000_000_000 % ARTIFACT_RANGE_BUCKET_MS)
    expect(bucketArtifactNow(base)).toBe(base)
    expect(bucketArtifactNow(base + 1)).toBe(base)
    expect(bucketArtifactNow(base + ARTIFACT_RANGE_BUCKET_MS - 1)).toBe(base)
    expect(bucketArtifactNow(base + ARTIFACT_RANGE_BUCKET_MS)).toBe(base + ARTIFACT_RANGE_BUCKET_MS)
  })
})
