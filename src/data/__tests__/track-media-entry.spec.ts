/**
 * One media entry has THREE operator-visible states, and they must never be
 * confused with each other.
 *
 * The confusion is not hypothetical. On a hub under disk contention
 * `pipelineAnalytics.getTrackMedia` (the byte read) hit its 60 s ceiling while
 * `pipelineAnalytics.listTrackMedia` (the manifest) answered 7 rows in 0.25 s.
 * The modal showed nothing, and "nothing" was read — by an operator and then
 * by an audit — as "this track has no media". Every row was indexed; only the
 * pixels were slow.
 *
 * So: a read that FAILED is `error` with a retry, and only an entry the INDEX
 * does not list is `absent`. The nastiest case is the last one here — the call
 * answered, and answered without the bytes for a key the manifest vouched
 * for. That is a failed read wearing absence's clothes, and it resolves to
 * `error`.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveTrackMediaEntryState,
  restrictKindsToEntry,
  trackMediaEntryNeedsFetch,
  isTrackMediaByteKind,
  type TrackMediaEntryState,
} from '../track-media-entry.js'
import type { MediaFileLite } from '../track-events.js'

const KEY_FRAME: MediaFileLite = {
  mediaId: 101,
  url: '/addon/pipeline-analytics/event-media/m/101',
  kind: 'keyFrameSmall',
  timestamp: 20,
  sizeBytes: 41_002,
}

function statusOf(state: TrackMediaEntryState): string {
  return state.status
}

describe('resolveTrackMediaEntryState — the three states', () => {
  it('exists in the index, no answer yet → loading', () => {
    expect(
      statusOf(resolveTrackMediaEntryState({ selected: KEY_FRAME, fetchFailed: false, rows: null })),
    ).toBe('loading')
  })

  it('exists in the index, the read THREW → error (not absent)', () => {
    expect(
      statusOf(resolveTrackMediaEntryState({ selected: KEY_FRAME, fetchFailed: true, rows: null })),
    ).toBe('error')
  })

  it('the index lists nothing → absent', () => {
    expect(
      statusOf(resolveTrackMediaEntryState({ selected: null, fetchFailed: false, rows: null })),
    ).toBe('absent')
  })

  it('answered with the bytes → ready, carrying them', () => {
    const state = resolveTrackMediaEntryState({
      selected: KEY_FRAME,
      fetchFailed: false,
      rows: [{ ...KEY_FRAME, base64: 'AAAA' }],
    })
    expect(state).toEqual({ status: 'ready', base64: 'AAAA' })
  })
})

describe('resolveTrackMediaEntryState — a thin answer is a FAILED READ', () => {
  it('answered, but carried no row for a key the manifest listed → error', () => {
    expect(
      statusOf(
        resolveTrackMediaEntryState({ selected: KEY_FRAME, fetchFailed: false, rows: [] }),
      ),
    ).toBe('error')
  })

  it('answered with the row but no bytes in it → error, never absent', () => {
    expect(
      statusOf(
        resolveTrackMediaEntryState({
          selected: KEY_FRAME,
          fetchFailed: false,
          rows: [{ ...KEY_FRAME, base64: '' }],
        }),
      ),
    ).toBe('error')
  })

  it('answered about a DIFFERENT key only → error for the selected one', () => {
    expect(
      statusOf(
        resolveTrackMediaEntryState({
          selected: KEY_FRAME,
          fetchFailed: false,
          rows: [{ mediaId: 202, kind: 'thumbnail', timestamp: 20, base64: 'ZZZ' }],
        }),
      ),
    ).toBe('error')
  })
})

describe('bytes already in hand cost no round-trip', () => {
  const synthetic: MediaFileLite = {
    mediaId: 303,
    kind: 'plateCrop',
    timestamp: 5,
    base64: 'PLATE',
  }

  it('is ready immediately', () => {
    expect(
      resolveTrackMediaEntryState({ selected: synthetic, fetchFailed: false, rows: null }),
    ).toEqual({ status: 'ready', base64: 'PLATE' })
  })

  it('needs no fetch', () => {
    expect(trackMediaEntryNeedsFetch(synthetic)).toBe(false)
  })
})

describe('a kind the cap cannot serve is never SENT', () => {
  const odd: MediaFileLite = { mediaId: 404, kind: 'someFutureKind', timestamp: 1 }

  it('is not a byte kind', () => {
    expect(isTrackMediaByteKind('someFutureKind')).toBe(false)
    expect(isTrackMediaByteKind('keyFrameSmall')).toBe(true)
  })

  it('needs no fetch, and is ready to render from its URL rather than reported broken', () => {
    expect(trackMediaEntryNeedsFetch(odd)).toBe(false)
    expect(resolveTrackMediaEntryState({ selected: odd, fetchFailed: false, rows: null })).toEqual({
      status: 'ready',
      base64: null,
    })
  })
})

describe('restrictKindsToEntry — one entry, one kind', () => {
  it('asks for exactly the selected kind', () => {
    expect(restrictKindsToEntry('keyFrameSmall')).toEqual(['keyFrameSmall'])
  })

  it('never widens beyond one', () => {
    expect(restrictKindsToEntry('thumbnail')).toHaveLength(1)
  })
})
