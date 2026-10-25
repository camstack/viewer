/**
 * What each Library page remembers of its filter bar: the parsers degrade field
 * by field, a stale id is dropped only against a list that ANSWERED, and the
 * review pages open on confidence when nothing is remembered.
 */
import { describe, expect, it } from 'vitest'
import {
  ARTIFACTS_REMEMBERED_DEFAULTS,
  REVIEW_REMEMBERED_DEFAULTS,
  RETRAIN_REMEMBERED_DEFAULTS,
  parseArtifactsRemembered,
  parseRetrainRemembered,
  parseReviewRemembered,
  pruneArtifactsRemembered,
  pruneKnownIds,
  pruneRetrainRemembered,
  pruneReviewRemembered,
} from '../library-filters.js'
import { DEFAULT_FACE_REVIEW_SORT } from '../../data/face-review-filters.js'
import { STORAGE_KEY_LEVELS, storageLevelOf } from '../storage-levels.js'

describe('the review pages default to confidence', () => {
  it('opens on the most certain / most confident first', () => {
    expect(DEFAULT_FACE_REVIEW_SORT).toEqual({ key: 'certainty', direction: 'desc' })
    expect(REVIEW_REMEMBERED_DEFAULTS.sort).toEqual({ key: 'certainty', direction: 'desc' })
    expect(parseReviewRemembered(undefined).sort).toEqual({ key: 'certainty', direction: 'desc' })
  })

  it('a remembered sort wins over the default', () => {
    expect(parseReviewRemembered({ sort: { key: 'date', direction: 'asc' } }).sort).toEqual({ key: 'date', direction: 'asc' })
  })

  it('a malformed sort is the default, not half of one', () => {
    expect(parseReviewRemembered({ sort: { key: 'date', direction: 'sideways' } }).sort).toEqual(DEFAULT_FACE_REVIEW_SORT)
    expect(parseReviewRemembered({ sort: { key: 'importance', direction: 'asc' } }).sort).toEqual(DEFAULT_FACE_REVIEW_SORT)
  })
})

describe('parsers', () => {
  it('review: keeps known statuses, drops unknown tokens, keeps an explicit empty selection', () => {
    expect(parseReviewRemembered({ statuses: ['assigned', 'MARK', 'assigned'], deviceIds: [7, '8', 7.5] })).toMatchObject({
      statuses: ['assigned'],
      deviceIds: [7],
    })
    expect(parseReviewRemembered({ statuses: [] }).statuses).toEqual([])
    expect(parseReviewRemembered({ statuses: 'assigned' }).statuses).toEqual(REVIEW_REMEMBERED_DEFAULTS.statuses)
  })

  it('artifacts: known kinds only, cameras as integers', () => {
    expect(parseArtifactsRemembered({ kinds: ['export', 'MARK-kind'], deviceIds: [3, null] })).toEqual({
      kinds: ['export'],
      deviceIds: [3],
    })
    expect(parseArtifactsRemembered('garbage')).toEqual(ARTIFACTS_REMEMBERED_DEFAULTS)
  })

  it('retrain: one camera and one collection, else null', () => {
    expect(parseRetrainRemembered({ deviceId: 7, collectionId: 'c1' })).toEqual({ deviceId: 7, collectionId: 'c1' })
    expect(parseRetrainRemembered({ deviceId: '7', collectionId: '' })).toEqual(RETRAIN_REMEMBERED_DEFAULTS)
  })

  it('never remembers the day', () => {
    expect(parseReviewRemembered({ dayMs: 123 })).not.toHaveProperty('dayMs')
    expect(parseArtifactsRemembered({ dayOffset: 3 })).not.toHaveProperty('dayOffset')
  })
})

describe('stale ids', () => {
  const known = new Set([7, 8])

  it('drops an id the hub no longer has', () => {
    expect(pruneKnownIds([7, 99], known)).toEqual([7])
    expect(pruneReviewRemembered({ ...REVIEW_REMEMBERED_DEFAULTS, deviceIds: [99] }, known).deviceIds).toEqual([])
    expect(pruneArtifactsRemembered({ kinds: [], deviceIds: [8, 99] }, known).deviceIds).toEqual([8])
    expect(pruneRetrainRemembered({ deviceId: 99, collectionId: 'gone' }, known, new Set(['c1']))).toEqual({
      deviceId: null,
      collectionId: null,
    })
  })

  it('drops NOTHING while the list has not answered', () => {
    const value = { ...REVIEW_REMEMBERED_DEFAULTS, deviceIds: [99] }
    expect(pruneReviewRemembered(value, undefined)).toBe(value)
    expect(pruneRetrainRemembered({ deviceId: 99, collectionId: 'gone' }, undefined, undefined)).toEqual({
      deviceId: 99,
      collectionId: 'gone',
    })
  })

  it('returns the SAME value when nothing was dropped (no write-back loop)', () => {
    const value = { kinds: [], deviceIds: [7] }
    expect(pruneArtifactsRemembered(value, known)).toBe(value)
  })
})

describe('levels', () => {
  it('every section is a DEVICE key, one copy per hub', () => {
    for (const section of ['events', 'artifacts', 'faces', 'plates', 'retrain']) {
      const entry = storageLevelOf(`camstack.v2.library-filter.${section}@hub-a`)
      expect(entry?.level, section).toBe('device')
      expect(entry?.match, section).toBe('per-hub')
    }
    expect(STORAGE_KEY_LEVELS.filter((e) => e.key.startsWith('camstack.v2.library-filter.'))).toHaveLength(5)
  })
})
