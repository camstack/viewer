/**
 * @vitest-environment jsdom
 *
 * The plate (and face) tile of a track whose crop lives ONLY in the gallery.
 *
 * ## What production actually holds
 *
 * A plate crop is not stored as the track's media. The row lives under its
 * OWN owner (`plate`, `plate-<trackId>`), addressed by its OWN media row id
 * (D482) — `plateGallery.getPlateByTrack` reports it as `cropUrl:
 * '/addon/pipeline-analytics/event-media/m/<mediaId>'`, never a key that
 * embeds the owner.
 *
 * and an older hub's `listTrackMedia` / `getTrackMedia` read `('track',
 * trackId)`. Measured on three live tracks: the manifest answered 6-7 rows and
 * not one plate, while `plateGallery.getPlateByTrack` returned the crop for
 * every one. The detail therefore merges a SYNTHETIC `plateCrop` tile from the
 * gallery — carrying the gallery row's own `cropUrl` verbatim and no bytes,
 * because that is what a hub serving `cropUrl` sends.
 *
 * ## The regression this pins shut (v1.0.405)
 *
 * The lazy per-entry loader then asked `getTrackMedia({ kinds: ['plateCrop'] })`
 * for that tile's bytes: wrong owner AND wrong kind, so the hub answered `[]`.
 * Not `null` — so not "loading" — and no row for the key, so the loader called
 * it a FAILED read and the hero showed the red triangle over a crop the hub was
 * holding. The strip's thumbnail kept working the whole time, because it renders
 * by URL and never asks.
 *
 * The hub stub below is that hub, verbatim: a manifest with no detail crop, a
 * gallery row with `cropUrl` and no `base64`, and a byte read that can only
 * answer for the kinds the manifest listed. Nothing here is a value production
 * forgot to send.
 *
 * `faceCrop` sat in the same client-side kind list, one merged tile away from
 * the identical failure, so it is asserted on the same terms.
 *
 * ## What the hero looks like from here
 *
 * There is no layout under jsdom, so `onLayout` never reports a width and the
 * zoomable hero IMAGE is never mounted. What the hero does render at every
 * width is its state: the loading notice, the error notice + retry, the absent
 * notice — or, when the entry is READY, none of the three plus the type badge
 * naming the shown media. That badge is therefore the positive signal here, and
 * it is the operator's signal too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { failExpoImageWhen, resetExpoImageFailures } from '../../../../testing/native-stubs/expo-image'
import React from 'react'
import enLocale from '../../../../../locales/en.json'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { TrackDetailView } from '../TrackDetailView.js'
import type { TrackSummary } from '../../../../data/track-events.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 102
const TRACK_ID = 'a3019e7a-ff67-4098-aae4-20dd552dedbe'
const BEST_EVENT_ID = 'evt-best'
const MEDIA_PREFIX = '/addon/pipeline-analytics/event-media/'

const PLATE_MEDIA_ID = 501
const FACE_MEDIA_ID = 502

const PLATE_LABEL = enLocale.v2.mediaKind.plateCrop
const FACE_LABEL = enLocale.v2.mediaKind.faceCrop
const HERO_LOADING = enLocale.v2.tracks.mediaEntryLoading
const HERO_ERROR = enLocale.v2.tracks.mediaEntryError
const HERO_ABSENT = enLocale.v2.tracks.mediaEntryAbsent

interface ManifestRow {
  readonly mediaId: number
  readonly url: string
  readonly kind: string
  readonly sizeBytes: number
  readonly timestamp: number
}

/** `listTrackMedia` as an older hub answers it: the track owner only. */
const MANIFEST: readonly ManifestRow[] = [
  { mediaId: 1, url: `${MEDIA_PREFIX}m/1`, kind: 'firstFrame', sizeBytes: 104_827, timestamp: 1_787_000_001_000 },
  { mediaId: 2, url: `${MEDIA_PREFIX}m/2`, kind: 'keyFrame', sizeBytes: 411_002, timestamp: 1_787_000_002_000 },
  { mediaId: 3, url: `${MEDIA_PREFIX}m/3`, kind: 'keyFrameSmall', sizeBytes: 41_002, timestamp: 1_787_000_002_000 },
  { mediaId: 4, url: `${MEDIA_PREFIX}m/4`, kind: 'thumbnail', sizeBytes: 22_140, timestamp: 1_787_000_002_000 },
  { mediaId: 5, url: `${MEDIA_PREFIX}m/5`, kind: 'thumbnailSmall', sizeBytes: 7_140, timestamp: 1_787_000_002_000 },
  { mediaId: 6, url: `${MEDIA_PREFIX}m/6`, kind: 'lastFrame', sizeBytes: 98_311, timestamp: 1_787_000_003_000 },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `getTrackMedia` on that same hub: it can only answer for what it listed. */
function trackMediaBytes(input?: unknown): readonly Record<string, unknown>[] {
  const kinds = isRecord(input) && Array.isArray(input.kinds) ? input.kinds : null
  const rows = kinds === null ? MANIFEST : MANIFEST.filter((row) => kinds.includes(row.kind))
  return rows.map((row) => ({ ...row, base64: 'AAAA' }))
}

function hub(): Record<string, unknown> {
  return {
    'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
    'pipelineAnalytics.listTrackMedia': MANIFEST,
    'pipelineAnalytics.getTrackMedia': trackMediaBytes,
    // The crops the track listing cannot see — URL only, no bytes. This is the
    // shape every hub that serves `cropUrl` sends: its own media row address
    // (D482), never a key that embeds the owner.
    'plateGallery.getPlateByTrack': {
      plateId: `plate-${TRACK_ID}`,
      deviceId: DEVICE_ID,
      trackId: TRACK_ID,
      timestamp: 1_787_000_004_000,
      text: 'WDMUN5Z',
      cropUrl: `${MEDIA_PREFIX}m/${PLATE_MEDIA_ID}`,
    },
    'faceGallery.getFaceByTrack': {
      faceId: `face-${TRACK_ID}`,
      deviceId: DEVICE_ID,
      trackId: TRACK_ID,
      timestamp: 1_787_000_004_000,
      assigned: false,
      cropUrl: `${MEDIA_PREFIX}m/${FACE_MEDIA_ID}`,
    },
  }
}

function track(): TrackSummary {
  return {
    trackId: TRACK_ID,
    deviceId: DEVICE_ID,
    cameraName: 'Front door',
    className: 'vehicle',
    firstSeen: 1_787_000_001_000,
    lastSeen: 1_787_000_005_000,
    state: 'closed',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    audioLabels: [],
    bestEventId: BEST_EVENT_ID,
  }
}

function view(): React.ReactElement {
  return React.createElement(TrackDetailView, { track: track() })
}

/** The `kinds` every byte read asked for. */
function kindsAsked(): readonly unknown[] {
  return hubCalls()
    .filter((call) => call.path === 'pipelineAnalytics.getTrackMedia')
    .map((call) => (isRecord(call.input) ? call.input.kinds : undefined))
}

/** Every URI the stubbed `expo-image` was handed (the strip tiles). */
function imageUris(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('[data-testid^="expo-image:"]')].map((el) =>
    (el.getAttribute('data-testid') ?? '').slice('expo-image:'.length),
  )
}

/** Leaf elements whose whole text is exactly `label`. */
function leaves(container: HTMLElement, label: string): readonly Element[] {
  return [...container.querySelectorAll('div')].filter(
    (el) => el.children.length === 0 && el.textContent === label,
  )
}

/** Click the strip tile labelled `label`. */
function selectTile(container: HTMLElement, label: string): void {
  const [tile] = leaves(container, label)
  expect(tile, `no strip tile labelled "${label}"`).toBeDefined()
  const pressable = tile?.closest('[tabindex], [role="button"]') ?? tile?.parentElement ?? null
  expect(pressable).not.toBeNull()
  if (pressable !== null) fireEvent.click(pressable)
}

/**
 * Wait for the hero to SETTLE on the entry labelled `label`, and report what it
 * settled on.
 *
 * Settled means one of two observable things, never "no notice yet": the error
 * notice appeared, or the hero's own type badge did — and the badge renders
 * only while the entry is `ready`, so its arrival is the positive signal. The
 * hero starts every mount on `absent` (nothing selected until the manifest
 * lands) and passes through `loading`, so anything that merely checks the
 * current text is reading a transient.
 */
type HeroOutcome = 'ready' | 'error' | 'absent'

async function heroOutcome(container: HTMLElement, label: string): Promise<HeroOutcome> {
  let outcome: HeroOutcome = 'absent'
  await waitFor(() => {
    const text = container.textContent ?? ''
    if (text.includes(HERO_ERROR)) {
      outcome = 'error'
      return
    }
    // The strip tile carries the same label; the second one IS the badge.
    if (leaves(container, label).length === 2) {
      outcome = 'ready'
      return
    }
    throw new Error(
      `hero not settled (loading=${String(text.includes(HERO_LOADING))} absent=${String(
        text.includes(HERO_ABSENT),
      )})`,
    )
  })
  return outcome
}

afterEach(() => {
  resetExpoImageFailures()
  cleanup()
})

describe('a detail crop that lives only in the gallery renders — never a failed read', () => {
  it('the PLATE tile resolves READY, and the hero badge names it', async () => {
    const { container } = mountScreen(view(), { hub: hub() })

    await waitFor(() => expect(leaves(container, PLATE_LABEL).length).toBe(1))
    selectTile(container, PLATE_LABEL)

    // The regression: `[]` from a cap that was asked the wrong question, read
    // as a byte read that failed. `ready` here means the hero painted its type
    // badge — the second element carrying the plate label.
    await expect(heroOutcome(container, PLATE_LABEL)).resolves.toBe('ready')
  })

  it('the tile still points at the plate crop on the data plane', async () => {
    // The pixels were never the problem: the strip renders by URL and always
    // worked. The hero must resolve to the SAME key rather than to an error.
    const { container } = mountScreen(view(), { hub: hub() })

    await waitFor(() =>
      expect(imageUris(container).some((uri) => uri.includes(`m/${PLATE_MEDIA_ID}`))).toBe(true),
    )
  })

  it('never asks getTrackMedia for a kind the manifest did not list', async () => {
    // The call cannot be answered — the row is under `('plate', 'plate-<id>')`
    // with `kind: 'crop'` — so making it can only produce a wrong error.
    const { container } = mountScreen(view(), { hub: hub() })

    await waitFor(() => expect(leaves(container, PLATE_LABEL).length).toBeGreaterThan(0))
    selectTile(container, PLATE_LABEL)
    await expect(heroOutcome(container, PLATE_LABEL)).resolves.toBe('ready')

    for (const kinds of kindsAsked()) {
      expect(kinds).not.toContain('plateCrop')
      expect(kinds).not.toContain('faceCrop')
    }
  })

  it('the FACE tile behaves identically — the same defect, one tile away', async () => {
    const { container } = mountScreen(view(), { hub: hub() })

    await waitFor(() => expect(leaves(container, FACE_LABEL).length).toBe(1))
    selectTile(container, FACE_LABEL)

    await expect(heroOutcome(container, FACE_LABEL)).resolves.toBe('ready')
    expect(imageUris(container).some((uri) => uri.includes(`m/${FACE_MEDIA_ID}`))).toBe(true)
  })

  // SKIPPED, honestly: under jsdom the hero frame never receives a layout, so
  // its height stays 0 and the hero <Image> is never mounted — there is no
  // image to fail. The error path is the image's own `onError` (production),
  // and needs a layout-driven mount to be exercised here. The stub already
  // supports failing a source (`failExpoImageWhen`).
  it.skip('a manifest-listed entry whose IMAGE fails to load is still an ERROR', async () => {
    // The rule survives the move from bytes to URLs: the manifest vouched for
    // this key, so a hero that cannot be fetched is a failed read and has to
    // say so — never painted as absent. The hero is the one URL without the
    // thumb variant (the strip tiles carry it).
    failExpoImageWhen((uri) => uri.length > 0 && !uri.includes('variant=thumb'))
    const { container } = mountScreen(view())

    // A positive wait: the notice has to APPEAR, and it names the failure.
    await waitFor(() => expect(container.textContent ?? '').toContain(HERO_ERROR))
  })
})
