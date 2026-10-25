/**
 * Standing viewer → hub traffic that can churn hub-main.
 *
 * This is the catalogue, not a preference. A new short poll, a per-camera
 * fan-out after a timeout, or a getEventMedia storm belongs on this list
 * BEFORE it ships — otherwise the next "hub is unusable" session re-discovers
 * it from Loki. Intervals at `RECONCILE_MS` (5 min) are the D8 backstop and
 * are not catalogued here.
 *
 * Measured amplifiers (2026-08-24, Events unusable ~19:13):
 *
 *  1. `listEventKindsBatch` timeout → N `listEventKinds` (FIXED: timeout
 *     returns [] ; fan-out only on missing procedure).
 *  2. `snapshot.getSnapshotLinks` every 5 s for visible tiles (KEEP — D108
 *     capture trigger). Must stay gated by `useScreenActive`. Since
 *     2026-09-10 one tick names a SLICE of the demand set (a quarter, plus
 *     anything not yet minted — `snapshot-link-slices.ts`), so the hub's
 *     captures and the client's image GETs are spread over the cycle instead
 *     of bursting together every 15 s.
 *  3. Events embed `listRecentTracks` poll is OFF by default (`DEFAULT_EVENTS_REFRESH_MS = 0`);
 *     `pipeline-analytics.track-lifecycle` is the mechanism.
 *  4. HTTP `/addon/pipeline-analytics/event-media/?kind=thumbnailSmall` per
 *     card (analytics runner Sharp, not hub-main — still a paint burst).
 *  5. `getEventMedia` base64 is retired — tiles fail to the class icon.
 *  6. `snapshot.getSnapshotLinks` signed poster on grid-tile cold start AND
 *     the WebView player cold-start poster.
 *  7. `POST /addon/stream-broker/clientlog` every 4 s.
 *  8. Theater `listTracks` live tail at `RECONCILE_MS` (event-backed).
 *  9. Theater heatmap `events.getEvents` at `RECONCILE_MS` (event-backed).
 * 10. Stationary overlay follows `pipeline-analytics.stationary-changed`.
 * 11. `networkQuality.reportClientStats` on adaptive WebRTC (interval from
 *     session config; no-ops if unset).
 * 12. Derived `libx264` 640×360 (broker CPU, not hub-main) — viewer quality
 *     `mid-to-low`, standing while a session is up.
 * 13. `streamBroker.getLiveViewerCounts` every 10 s while a live-viewers overlay
 *     is placed — ONE query for every camera on screen (the hosted wall's
 *     twin, `embed/src/embed/live-viewers.ts`, is one shared poller). No event
 *     announces a viewer joining; the call is two in-memory map walks on the hub.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECONCILE_MS, STATIONARY_POLL_MS } from '../reconcile.js'
import { SNAPSHOT_LINKS_POLL_MS } from '../use-snapshot-links.js'
import { SNAPSHOT_OVERVIEW_POLL_MS } from '../use-snapshot-overview.js'
import { LIVE_FIELDS_POLL_MS } from '../use-device-live-fields.js'
import { SNAPSHOT_REFETCH_MS } from '../use-snapshot.js'
import { DEFAULT_EVENTS_REFRESH_MS } from '../../../embed/src/embed/events-config.js'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const read = (...parts: readonly string[]): string => readFileSync(join(SRC, ...parts), 'utf8')

describe('standing hub polls faster than the 5 min reconcile', () => {
  it('keeps getSnapshotLinks at 5 s — it is the capture trigger (D108)', () => {
    expect(SNAPSHOT_LINKS_POLL_MS).toBe(5_000)
    expect(SNAPSHOT_LINKS_POLL_MS).toBeLessThan(RECONCILE_MS)
  })

  it('does not let overview or live-fields sneak back to 5 s', () => {
    expect(SNAPSHOT_OVERVIEW_POLL_MS).toBe(RECONCILE_MS)
    expect(LIVE_FIELDS_POLL_MS).toBe(RECONCILE_MS)
  })

  it('names the remaining short cadences so a silent drop is a red test', () => {
    expect(DEFAULT_EVENTS_REFRESH_MS).toBe(0)
    expect(STATIONARY_POLL_MS).toBe(15_000)
    expect(SNAPSHOT_REFETCH_MS).toBe(10_000)
    expect(read('lib', 'logger.ts')).toContain('const SHIP_INTERVAL_MS = 4000')
    expect(read('data', 'use-device-tracks.ts')).toContain(
      'refetchInterval: pollLive && liveWindow ? RECONCILE_MS : false',
    )
    expect(read('data', 'use-notification-center.ts')).toContain('refetchInterval: 30_000')
  })

  it('snapshot demand is gated on the visible screen', () => {
    expect(read('hooks', 'use-screen-active.ts')).toContain('export function useScreenActive')
    expect(read('screens', 'CamerasScreen.tsx')).toContain('useScreenActive')
    expect(read('screens', 'GridsScreen.tsx')).toContain('useScreenActive')
    expect(read('data', 'use-events-gallery-feed.ts')).toContain('useScreenActive')
  })
})

describe('fan-out after a timeout is forbidden', () => {
  it('the host taxonomy fans out listEventKinds only for a missing procedure', () => {
    const load = read('data', 'event-kinds-load.ts')
    expect(load).toContain('deadlineMs: BULK_QUERY_DEADLINE_MS')
    expect(load).toContain('rethrow: true')
    expect(load).toContain('isQueryDeadlineError')
    expect(load).toContain('isMissingProcedureError')
    expect(read('data', 'use-event-kinds.ts')).not.toContain("'listEventKinds'")
    expect(read('data', 'use-event-kinds.ts')).toContain('loadEventKinds')
  })

  it('the embed Events client never has a per-camera listEventKinds path', () => {
    const client = readFileSync(join(ROOT, 'embed/src/embed/events-client.ts'), 'utf8')
    expect(client).toContain('listEventKindsBatch')
    expect(client).not.toContain('listEventKinds.query')
  })
})

describe('paint-burst endpoints stay named', () => {
  it('event-media tiles ask for thumbnailSmall over HTTP, never getEventMedia', () => {
    expect(
      readFileSync(join(ROOT, 'shared/events/events-media-url.ts'), 'utf8'),
    ).toContain('kind=thumbnailSmall')
    expect(read('data', 'use-event-media.ts')).not.toContain("'getEventMedia'")
    expect(read('data', 'use-event-media.ts')).toContain('onError')
  })

  it('grid tile and WebView player posters use signed snapshot links, not base64 getSnapshot', () => {
    const tile = readFileSync(join(ROOT, 'embed/src/components/GridTilePlayer.tsx'), 'utf8')
    expect(tile).toContain('snapshot.getSnapshotLinks')
    expect(tile).not.toContain('snapshot.getSnapshot.query')
    expect(read('live', 'LiveViewWebView.tsx')).toContain('useSnapshotLink')
    expect(read('live', 'LiveViewWebView.tsx')).not.toContain('useSnapshotDataUri')
    expect(read('data', 'use-snapshot.ts')).not.toContain('export function useSnapshotDataUri')
  })
})

describe('no new numeric refetchInterval under 60s in src/data without listing it', () => {
  it('every sub-minute poll in data/ is one of the named cadences', () => {
    const dataDir = join(SRC, 'data')
    const files = readdirSync(dataDir).filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    const allowed = new Set([
      'use-snapshot-links.ts',
      'use-notification-center.ts',
      'use-exports.ts',
      'use-occupancy.ts',
      'use-snapshot.ts',
      'use-timeline-activity.ts',
      'use-recording.ts',
      'use-storage-management.ts',
      'use-nc-artifacts.ts',
      'use-face-gallery.ts',
      'use-track-detail-media.ts',
      'use-track-by-id.ts',
      'use-event-kinds.ts',
      // Live-viewer count: ONE shared query for every camera, 10 s (no event
      // announces a viewer joining; the hub call is two in-memory map walks).
      'use-live-viewers.ts',
    ])
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(join(dataDir, file), 'utf8')
      if (!/refetchInterval:\s*\d/.test(src) && !/refetchInterval:\s*\w+_MS/.test(src)) continue
      if (src.includes('refetchInterval: RECONCILE_MS')) continue
      if (src.includes('LIVE_FIELDS_POLL_MS') && file === 'use-device-live-fields.ts') continue
      if (src.includes('SNAPSHOT_OVERVIEW_POLL_MS') && file === 'use-snapshot-overview.ts') continue
      if (allowed.has(file)) continue
      if (/refetchInterval:\s*(?:false|pollLive)/.test(src) && !/refetchInterval:\s*\d/.test(src))
        continue
      offenders.push(file)
    }
    expect(offenders, 'add the file to the allow-list and the catalogue comment').toEqual([])
  })
})
