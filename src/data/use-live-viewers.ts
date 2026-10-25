/**
 * useLiveViewerCount — how many people are watching a camera LIVE right now.
 *
 * Asks the hub's `streamBroker.getLiveViewerCounts` — ONE call that answers for
 * every camera at once — and hands each overlay its own camera's number. The
 * query key is shared, so a wall of twelve tiles with the overlay placed is one
 * request per poll, not twelve.
 *
 * ## Why a poll
 *
 * No event announces a viewer joining or leaving: the broker's consumer set
 * changes at connection granularity and nothing publishes it. The call is a
 * walk of two in-memory maps on the hub, so a short interval is cheap; the
 * overlay is a "right now" read-out, and ten seconds is as fresh as a person
 * reads it.
 *
 * ## Unknown is not zero
 *
 * `null` means "not answered": not connected yet, a hub that predates the
 * method, a call that failed or timed out. It is NOT "nobody is watching" and
 * the badge must not draw it as such. The hub omits a camera nobody watches
 * from its answer, so a camera that is missing from a SUCCESSFUL answer is a
 * real `0`.
 */
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'

/** How often the count is re-read while any overlay is showing it. */
export const LIVE_VIEWERS_POLL_MS = 10_000

/** Viewer count per camera id, for the cameras that have at least one. */
export type LiveViewerCounts = Readonly<Record<number, number>>

/**
 * Narrow the hub's answer. `null` — never an empty record — when the payload is
 * not the expected list, so a malformed or absent answer cannot masquerade as
 * "nobody watches anything". A row that is not `{deviceId, viewers ≥ 1}` is
 * dropped; the rest are kept.
 */
export function parseLiveViewerCounts(raw: unknown): LiveViewerCounts | null {
  if (!Array.isArray(raw)) return null
  const out: Record<number, number> = {}
  for (const row of raw) {
    if (!isRecord(row)) continue
    const { deviceId, viewers } = row
    if (typeof deviceId !== 'number' || !Number.isInteger(deviceId) || deviceId < 0) continue
    if (typeof viewers !== 'number' || !Number.isFinite(viewers) || viewers < 1) continue
    out[deviceId] = Math.floor(viewers)
  }
  return out
}

/** This camera's number from an answer: a camera absent from a successful
 *  answer is 0, and no answer at all is unknown. */
export function viewersFor(counts: LiveViewerCounts | null, deviceId: number): number | null {
  if (counts === null) return null
  return counts[deviceId] ?? 0
}

export const LIVE_VIEWERS_QUERY_KEY: readonly unknown[] = ['v2', 'live-viewers']

/**
 * The live viewer count for one camera, or `null` while it is not known.
 * Polls (shared across every observer) only while `enabled` and connected.
 */
export function useLiveViewerCount(deviceId: number, enabled: boolean): number | null {
  const { controller, state } = useConnection()
  const { data } = useQuery<LiveViewerCounts | null, Error, number | null>({
    queryKey: LIVE_VIEWERS_QUERY_KEY,
    enabled: enabled && state === 'connected',
    staleTime: LIVE_VIEWERS_POLL_MS,
    refetchInterval: LIVE_VIEWERS_POLL_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const client = system.trpcClient as Record<string, unknown>
      return parseLiveViewerCounts(await capQuery(client, 'streamBroker', 'getLiveViewerCounts'))
    },
    select: (counts) => viewersFor(counts, deviceId),
  })
  return data ?? null
}
