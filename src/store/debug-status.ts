/**
 * Local debug lifecycle for a track — none → open → reviewed.
 *
 * Lives on THIS client on purpose: no tracks-table migration, no new hub
 * column. A hub `debug: true` the client has never seen is `open`. Reviewing
 * remembers `reviewed` here and the caller CLEARS the hub flag so the debug
 * export drops the track.
 */

export type DebugStatus = 'none' | 'open' | 'reviewed'

export function resolveDebugStatus(
  debug: boolean | undefined,
  stored: DebugStatus | undefined,
): DebugStatus {
  if (stored === 'reviewed' && debug !== true) return 'reviewed'
  if (debug === true) return 'open'
  return 'none'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse a persisted map. Unknown keys/values are dropped, not defaulted. */
export function parseDebugStatuses(raw: unknown): Record<string, DebugStatus> {
  if (!isRecord(raw)) return {}
  const out: Record<string, DebugStatus> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (id.length === 0) continue
    if (value === 'open' || value === 'reviewed') out[id] = value
  }
  return out
}

/** Reviewed ids as a list the Library page can subscribe to without
 *  allocating a new array on every zustand read. */
export function reviewedIdsFrom(
  statuses: Readonly<Record<string, DebugStatus>>,
): readonly string[] {
  const ids: string[] = []
  for (const [id, status] of Object.entries(statuses)) {
    if (status === 'reviewed') ids.push(id)
  }
  return ids
}

/** Keep the previous snapshot when the reviewed set did not change. */
export function reuseReviewedIds(
  prev: readonly string[],
  statuses: Readonly<Record<string, DebugStatus>>,
): readonly string[] {
  const next = reviewedIdsFrom(statuses)
  if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev
  return next
}
