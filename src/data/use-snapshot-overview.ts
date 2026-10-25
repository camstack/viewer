/**
 * `snapshot.getSnapshotOverview` — the batch that carries METADATA, not pixels.
 *
 * The question "which of these 16 thumbnails changed?" used to be answered by
 * downloading 16 thumbnails. This answers it in one small RPC: ~40 bytes per
 * device (`lastCapturedAt`, `cacheAgeMs`, `etag`) against ~9 KB per tile, and it
 * is cache-only server-side — it NEVER triggers a capture, so polling it costs a
 * map lookup per device.
 *
 * It gives the client two things it could not do before:
 *
 *  1. **A change detector.** `lastCapturedAt` is the frame identity the image
 *     URL is versioned on (see `snapshot-media-url.ts`), so a tile refetches
 *     exactly when its frame moved and never on a timer.
 *  2. **An honest empty state.** A device that has never produced a frame
 *     reports `lastCapturedAt: null`, so the grid renders "no snapshot yet"
 *     instead of firing a request that 404s. Device 106 on the live hub is
 *     exactly this, and nothing surfaced it.
 *
 * The cap is new, so it is called through `capQuery`: an older hub answers
 * NOT_FOUND, which degrades to `supported: false` and the pre-existing
 * behaviour (a stable URL, web-side ETag revalidation).
 */
import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { BULK_QUERY_DEADLINE_MS, capQuery, isRecord } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'

/**
 * Reconcile cadence for the overview. It is a BACKSTOP, not the mechanism.
 *
 * It used to be 5 s, matched to the server's keep-warm tick, and the comment
 * here said "deliberately NOT `RECONCILE_MS` — this is the freshness mechanism
 * itself". Both halves of that stopped being true:
 *
 *  - The warm tick is gone. [D108](../../../docs/decisions/adr-0108.md) deleted
 *    the server's loop entirely, so there is no longer a cadence on the hub to
 *    match. `WARM_INTERVAL_MS` does not exist in the server tree.
 *  - The freshness mechanism is now `getSnapshotLinks`, which both TRIGGERS the
 *    capture and reports the resulting `capturedAt`. Every surface that reads
 *    `useSnapshotVersion` also holds a link for the same device (`useSnapshot`
 *    calls both), so for anything actually on screen this call restates, one
 *    round trip later, a fact the tile already has from an authority.
 *
 * What is left is the genuine reconcile role: the window before the first link
 * answers, and a device whose link mint failed. That is what `RECONCILE_MS` is
 * for, and it takes this call from 12 requests a minute to one every five.
 *
 * It must NOT be shortened again to make tiles fresher — that is the links
 * poll's job, and a second freshness mechanism competing with it is what D108
 * removed from the server side.
 */
export const SNAPSHOT_OVERVIEW_POLL_MS = RECONCILE_MS

/** One device's cached-frame identity. */
export interface SnapshotOverviewRow {
  readonly deviceId: number
  /** Epoch ms of the newest cached capture, or null if the device never produced one. */
  readonly lastCapturedAt: number | null
  readonly cacheAgeMs: number | null
  readonly etag: string | null
}

export interface SnapshotOverview {
  readonly supported: boolean
  readonly byId: Readonly<Record<number, SnapshotOverviewRow>>
}

const UNSUPPORTED: SnapshotOverview = Object.freeze({ supported: false, byId: {} })

/** Narrow one raw row; anything malformed is dropped rather than rendered. */
function parseRow(raw: unknown): SnapshotOverviewRow | null {
  if (!isRecord(raw)) return null
  const deviceId = raw['deviceId']
  if (typeof deviceId !== 'number') return null
  const lastCapturedAt = raw['lastCapturedAt']
  const cacheAgeMs = raw['cacheAgeMs']
  const etag = raw['etag']
  return {
    deviceId,
    lastCapturedAt: typeof lastCapturedAt === 'number' ? lastCapturedAt : null,
    cacheAgeMs: typeof cacheAgeMs === 'number' ? cacheAgeMs : null,
    etag: typeof etag === 'string' ? etag : null,
  }
}

/** The cap's own input bound. A larger install is chunked by the caller. */
const MAX_DEVICE_IDS = 200

/**
 * Fetch one overview batch.
 *
 * Extracted from the hook so the distinction below is TESTABLE — this suite has
 * no react renderer, so a rule that lives inside a `queryFn` is a rule nothing
 * can check.
 *
 * ## `supported: false` means "this hub has no such cap" and NOTHING else
 *
 * It used to also mean "the call timed out", because `capQuery` collapsed both
 * into null. Measured over 24h on the live hub, this call was the second-biggest
 * consumer of the badge-sized deadline (110 expiries) — and every one of them
 * did more than fail: returning `UNSUPPORTED` OVERWRITES the cached truth, so a
 * transient timeout told the whole app the hub had no snapshot capability and
 * flipped every tile off the minted-link path until the next poll undid it.
 * React Query saw a success, so `placeholderData` could not protect the good
 * answer either.
 *
 * Now a failure REJECTS: the last successful overview stays in cache, the tiles
 * hold their last known identity, and `resolveSnapshotUri`'s `identityKnown`
 * fallback does what it was built for. An absent cap still answers
 * `UNSUPPORTED`, because that is a real answer.
 */
export async function fetchSnapshotOverview(
  client: Record<string, unknown>,
  ids: readonly number[],
  deadlineMs: number = BULK_QUERY_DEADLINE_MS,
): Promise<SnapshotOverview> {
  const raw: unknown = await capQuery(
    client,
    'snapshot',
    'getSnapshotOverview',
    { deviceIds: [...ids] },
    { deadlineMs, rethrow: true },
  )
  // Reachable only for a hub without the cap — `rethrow` sends everything else
  // to the caller.
  if (!Array.isArray(raw)) return UNSUPPORTED
  const byId: Record<number, SnapshotOverviewRow> = {}
  for (const entry of raw) {
    const row = parseRow(entry)
    if (row) byId[row.deviceId] = row
  }
  return { supported: true, byId }
}

export function useSnapshotOverview(
  deviceIds: readonly number[],
  enabled: boolean,
): UseQueryResult<SnapshotOverview> {
  const { controller, state } = useConnection()
  // Sorted + truncated so the query key is stable under re-ordering and the
  // input can never exceed what the cap accepts.
  const ids = useMemo(
    () => [...deviceIds].sort((a, b) => a - b).slice(0, MAX_DEVICE_IDS),
    [deviceIds],
  )

  return useQuery<SnapshotOverview>({
    queryKey: ['v2', 'snapshot-overview', ids],
    enabled: enabled && ids.length > 0 && state === 'connected',
    // Paired on purpose — the global 5 s staleTime default would otherwise make
    // every remount refetch out of band. See `reconcile.ts`.
    staleTime: SNAPSHOT_OVERVIEW_POLL_MS,
    refetchInterval: SNAPSHOT_OVERVIEW_POLL_MS,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<SnapshotOverview> => {
      const system = controller.getSystem()
      if (!system) return UNSUPPORTED
      return await fetchSnapshotOverview(
        system.trpcClient as unknown as Record<string, unknown>,
        ids,
      )
    },
  })
}
