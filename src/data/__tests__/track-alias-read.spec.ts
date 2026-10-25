/**
 * D683: the hub answers a fused (absorbed) id with its survivor
 * (`TrackFlagsResult.trackId`). A flag write is published under the id the
 * viewer ASKED with and under the survivor's, so neither cached row reads a
 * pre-write value.
 *
 * Disarm: publish only under the answer's id — "a flag write lands under the
 * asked id too" fails.
 *
 * Fix round 1 (review M2): the overlay-store dual write had NO test holding
 * it up — disarming `useTrackFlagOverlayStore.getState().apply(...)`
 * entirely left every test in this file green. "the live-feed overlay also
 * carries both ids" below closes that gap; its disarm is to remove the
 * overlay `apply` call (or hard-code it to `next.trackId` only) in
 * `publishTrackAnswer` — the new assertion goes red.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { publishTrackAnswer } from '../use-track-flags.js'
import { trackByIdQueryKey } from '../use-track-by-id.js'
import { useTrackFlagOverlayStore } from '../../store/track-flag-overlay-store.js'
import { trackSummaryFixture } from './track-summary-fixture.js'

describe('fused track ids in the viewer', () => {
  it('a flag write lands under the asked id too', () => {
    const qc = new QueryClient()
    qc.setQueryData(trackByIdQueryKey(101, 'B'), trackSummaryFixture({ trackId: 'A', debug: false }))
    qc.setQueryData(trackByIdQueryKey(101, 'A'), trackSummaryFixture({ trackId: 'A', debug: false }))
    publishTrackAnswer(qc, 101, 'B', { trackId: 'A', markForTrain: false, debug: true, debugNote: '', favourited: false })
    expect(qc.getQueryData(trackByIdQueryKey(101, 'B'))).toMatchObject({ debug: true })
    expect(qc.getQueryData(trackByIdQueryKey(101, 'A'))).toMatchObject({ debug: true })
  })

  it('the live-feed overlay also carries both ids, not just the survivor (review M2)', () => {
    const qc = new QueryClient()
    // Distinct ids from the test above — the overlay store is a module-level
    // singleton keyed by trackId alone, so a fresh pair avoids any
    // cross-test collision regardless of run order.
    publishTrackAnswer(qc, 101, 'overlay-B', {
      trackId: 'overlay-A',
      markForTrain: false,
      debug: true,
      debugNote: '',
      favourited: false,
    })
    const { patches } = useTrackFlagOverlayStore.getState()
    expect(patches['overlay-B']).toMatchObject({ debug: true })
    expect(patches['overlay-A']).toMatchObject({ debug: true })
  })
})
