/**
 * @vitest-environment jsdom
 *
 * The track detail asks what media a track HAS, never for the media itself.
 *
 * `a2ad2f7` ("media by URL, not 7.67MB of base64 up front") switched the parser
 * to `parseMediaManifest` and rewrote the hook's docblock to say
 * `listTrackMedia` — and left the CALL on `getTrackMedia`. The result held for
 * two weeks and was the single most expensive thing in the modal: the open paid
 * for every stored variant as base64, blocking, then discarded the bytes
 * (a manifest parser reads no `base64`) and re-fetched each visible tile over
 * HTTP anyway.
 *
 * Measured on the live hub across 12 tracks:
 *
 *     getTrackMedia    mean 1223 ms   mean 1536 KB   worst 6936 ms / 4308 KB
 *     listTrackMedia   mean   25 ms   mean  0.7 KB
 *
 * A docblock could not hold this shut — one had said the right thing while the
 * code did the wrong one. So the method name is asserted, and so is the
 * consequence that makes it matter: the strip must be buildable from rows that
 * carry NO bytes at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { useTrackDetailMedia } from '../use-track-detail-media.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 3829
const TRACK_ID = 'a3019e7a-ff67-4098-aae4-20dd552dedbe'
const BEST_EVENT_ID = 'evt-best'

/** Real `listTrackMedia` rows, captured from the hub: id, kind, url, size,
 *  stamp (D482) — and no `base64`. */
const MANIFEST: readonly Record<string, unknown>[] = [
  { mediaId: 1, url: '/addon/pipeline-analytics/event-media/m/1', kind: 'firstFrame', sizeBytes: 104_827, timestamp: 10 },
  { mediaId: 2, url: '/addon/pipeline-analytics/event-media/m/2', kind: 'keyFrame', sizeBytes: 411_002, timestamp: 20 },
  { mediaId: 3, url: '/addon/pipeline-analytics/event-media/m/3', kind: 'keyFrameSmall', sizeBytes: 41_002, timestamp: 20 },
  { mediaId: 4, url: '/addon/pipeline-analytics/event-media/m/4', kind: 'thumbnail', sizeBytes: 22_140, timestamp: 20 },
  { mediaId: 5, url: '/addon/pipeline-analytics/event-media/m/5', kind: 'lastFrame', sizeBytes: 98_311, timestamp: 30 },
]

function Probe(): React.ReactElement {
  const media = useTrackDetailMedia(DEVICE_ID, BEST_EVENT_ID, TRACK_ID)
  return React.createElement(
    'span',
    { 'data-testid': 'gallery' },
    media.loading ? 'loading' : String(media.gallery.length),
  )
}

function galleryText(container: HTMLElement): string {
  return container.querySelector('[data-testid="gallery"]')?.textContent ?? ''
}

function hub(): Record<string, unknown> {
  return {
    'pipelineAnalytics.getEventMedia': [
      { mediaId: 99, url: '/addon/pipeline-analytics/event-media/m/99', kind: 'crop', base64: 'AAA', timestamp: 20 },
    ],
    'pipelineAnalytics.listTrackMedia': MANIFEST,
    // Deliberately ALSO available. If the hook regresses to the byte-fetch it
    // would still work — and still be 2000x too big — so "it rendered" can
    // never be the thing that passes this test.
    'pipelineAnalytics.getTrackMedia': MANIFEST.map((row) => ({ ...row, base64: 'X'.repeat(4096) })),
  }
}

function pathsCalled(): readonly string[] {
  return hubCalls().map((call) => call.path)
}

describe('useTrackDetailMedia — the track leg is a MANIFEST', () => {
  it('asks listTrackMedia, and never getTrackMedia or getEventMedia', async () => {
    const { container } = mountScreen(React.createElement(Probe), { hub: hub() })

    await waitFor(() => expect(galleryText(container)).not.toBe('loading'))

    expect(pathsCalled()).toContain('pipelineAnalytics.listTrackMedia')
    expect(pathsCalled()).not.toContain('pipelineAnalytics.getTrackMedia')
    expect(pathsCalled()).not.toContain('pipelineAnalytics.getEventMedia')
  })

  it('builds the whole strip out of byte-less rows', async () => {
    const { container } = mountScreen(React.createElement(Probe), { hub: hub() })

    await waitFor(() => expect(galleryText(container)).toBe('5'))
  })
})

// ─── Failure semantics (2026-08-21) ─────────────────────────────────────────
//
// Two tracks reported "no media in the detail, only the best shot" while the
// hub verifiably held every row and blob (manifest 200, tiles 200). The open
// had raced a saturated analytics runner: the manifest call failed once,
// `capQuery` swallowed it to null, and React Query recorded a SUCCESS with an
// empty gallery — no message, no retry, the whole Media section silently
// absent. Same lie the timeline's batched reads already fixed for the band
// ("quiet hour"): a read that FAILED must never paint as "nothing exists".

/** Probe that also surfaces the failure state + retry affordance. */
function FailureProbe(): React.ReactElement {
  const media = useTrackDetailMedia(DEVICE_ID, BEST_EVENT_ID, TRACK_ID)
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'span',
      { 'data-testid': 'gallery' },
      media.loading ? 'loading' : media.failed ? 'failed' : String(media.gallery.length),
    ),
    React.createElement('button', { 'data-testid': 'retry', onClick: () => media.retry() }),
  )
}

describe('useTrackDetailMedia — a failed read is an ERROR, never a silent empty', () => {
  it('manifest failure with nothing else to show surfaces failed, and retry recovers', async () => {
    let calls = 0
    const { container } = mountScreen(React.createElement(FailureProbe), {
      hub: {
        'pipelineAnalytics.listTrackMedia': () => {
          calls += 1
          if (calls === 1) throw new Error('runner saturated')
          return MANIFEST
        },
      },
    })

    await waitFor(() => expect(galleryText(container)).toBe('failed'))

    container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click()
    await waitFor(() => expect(galleryText(container)).toBe('5'))
  })

  it('a genuinely empty track is EMPTY (0), not an error', async () => {
    const { container } = mountScreen(React.createElement(FailureProbe), {
      hub: {
        'pipelineAnalytics.listTrackMedia': [],
      },
    })

    await waitFor(() => expect(galleryText(container)).toBe('0'))
  })
})
