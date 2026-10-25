/**
 * The last short polls, and the reason only SOME of them may become events.
 *
 * The operator's ask (2026-08-21) was to finish what `use-live-invalidation.ts`
 * started: one subscription, no per-surface polls, initial hydration only.
 * `reconcile.ts` and the invalidation map already did that for the camera list,
 * accessories, battery and the badges. Four 5 s polls were left, and they are
 * NOT the same kind of thing:
 *
 *  - `getSnapshotLinks` **causes** the capture. [D108](../../../docs/decisions/adr-0108.md)
 *    deleted the server's warm loop: "a frame is captured when a caller asks
 *    for one, and at no other time … it makes the 5 s poll load-bearing in a
 *    way it was not before: it used to be one of two paths to a fresh frame,
 *    and is now the only one." There is nothing to subscribe TO — the snapshot
 *    addon emits no event on capture, and with no caller it performs no
 *    capture. Replacing this poll with a subscription freezes every thumbnail
 *    permanently. It stays, and the test below states why so that a future
 *    session does not "finish the migration" by deleting it.
 *
 *  - `getSnapshotOverview` is cache-only and captures nothing. It is a change
 *    DETECTOR, and every tile that paints also holds a link whose `capturedAt`
 *    is the same fact from an authority that is one round trip fresher. So it
 *    is redundant at 5 s for anything on screen, and its real job — covering
 *    the window before the first link answers, and a device whose link mint
 *    failed — is exactly the D8 reconcile role. It moves to `RECONCILE_MS`.
 *
 *  - `useDeviceLiveFields` reads sensor cap `getStatus` slices. A slice write
 *    goes through `device-state-mirror.ts`, which emits `device.state-changed`
 *    — the category this app has subscribed to since the first migration. This
 *    one is a genuine event + reconcile, and is the shape the operator asked
 *    for.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import { RECONCILE_MS } from '../reconcile.js'
import { SNAPSHOT_LINKS_POLL_MS } from '../use-snapshot-links.js'
import { SNAPSHOT_OVERVIEW_POLL_MS } from '../use-snapshot-overview.js'
import { LIVE_FIELDS_POLL_MS } from '../use-device-live-fields.js'
import { deviceStateInvalidationKeys } from '../use-live-invalidation.js'

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('the remaining short polls', () => {
  it('keeps the LINKS poll short, because it is the capture trigger (D108)', () => {
    // Not a preference. Raise this to the reconcile cadence and the hub
    // captures a frame once every five minutes per camera; every tile then
    // paints a frame up to five minutes old, which is the D93 incident.
    expect(SNAPSHOT_LINKS_POLL_MS).toBeLessThanOrEqual(5_000)
    expect(SNAPSHOT_LINKS_POLL_MS).toBeLessThan(RECONCILE_MS)
  })

  it('demotes the OVERVIEW poll to the reconcile cadence', () => {
    expect(SNAPSHOT_OVERVIEW_POLL_MS).toBe(RECONCILE_MS)
  })

  it('demotes LIVE FIELDS to the reconcile cadence', () => {
    expect(LIVE_FIELDS_POLL_MS).toBe(RECONCILE_MS)
  })

  it('pairs every demoted interval with a matching staleTime', () => {
    // The rule from `reconcile.ts`: the global default is `staleTime: 5000`, so
    // an interval without its own staleTime is stale after five seconds and
    // refetches on the next mount — the poll becomes the mechanism again, which
    // is the exact thing this change undoes. Ten hooks were missing it once.
    for (const file of ['../use-snapshot-overview.ts', '../use-device-live-fields.ts']) {
      const source = readSource(file)
      const interval = /refetchInterval:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(source)?.[1]
      const stale = /staleTime:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(source)?.[1]
      expect(interval, `${file} declares an interval`).toBeDefined()
      expect(stale, `${file} pairs a staleTime`).toBe(interval)
    }
  })

  it('gives the live-fields query a live channel on the shared subscription', () => {
    // A demoted poll with no event behind it is not a migration, it is just a
    // slower poll — a pinned dB readout would move once every five minutes.
    // The key must be reachable from `device.state-changed`, which is where the
    // sensor slice write lands.
    const source = readSource('../use-live-invalidation.ts')
    const key = /queryKey: \['v2', '(device-live-fields)'/.exec(
      readSource('../use-device-live-fields.ts'),
    )?.[1]
    expect(key).toBe('device-live-fields')
    // `device.state-changed` keys are payload-dependent now; the live fields
    // must follow EVERY cap's slice write, the telemetry ones included.
    expect(source).toContain('export function deviceStateInvalidationKeys')
    for (const capName of ['audio-metrics', 'temperature-sensor', 'switch', undefined]) {
      const keys = deviceStateInvalidationKeys({ data: { deviceId: 1, capName } })
      expect(keys.map((k) => k.join('/'))).toContain('v2/device-live-fields')
    }
  })
})
