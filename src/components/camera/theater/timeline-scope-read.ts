/**
 * timeline-scope-read — what a BATCHED timeline read actually learned, and
 * about which cameras it learned nothing.
 *
 * ## The property this module exists to keep
 *
 * The three timeline batches on the hub (`pipelineAnalytics.getEventDensityBatch`,
 * `recording.getAvailabilityBatch`, `recording.getDaysWithRecordingsBatch`)
 * answer with ONE ROW PER REQUESTED CAMERA, each tagged `read: 'read' |
 * 'unreadable'`. The tag is the whole point of the batch's shape:
 *
 *   • `'read'` with nothing in it is a CLAIM — read, and this camera had no
 *     footage / no events in the window.
 *   • `'unreadable'` is the ABSENCE of a claim — the recorder's calendar rung
 *     threw, the location is unmounted, nobody looked.
 *
 * Fanned out per camera the difference was free: one query rejected while the
 * others resolved. Collapsing N reads into one is exactly the moment it is lost
 * — the hub took care not to lose it, so the surface above must not be the one
 * that throws it away. A timeline that draws the second as the first tells an
 * operator "nothing happened here" when the truth is "nobody looked here", on
 * the one screen where that distinction is the reason they opened the app.
 *
 * ## And the ceiling is part of the same property
 *
 * Both hub schemas cap `deviceIds` at 200 and REFUSE an over-cap ask rather
 * than truncating it, for the same reason: a truncated answer is
 * indistinguishable from a complete one. The client half of that contract is
 * here — {@link planScopeAsk} splits the scope into what it will ask for and
 * what it could not, and the cameras it could not ask about end up in exactly
 * the same `unknownIds` as the ones the hub could not read. From the operator's
 * side they are the same fact: this camera is not represented, and it is not
 * because it was quiet.
 *
 * Pure — no React, no query client. Every rule below is asserted by value in
 * `__tests__/timeline-scope-read.spec.ts`.
 */

/**
 * Most cameras one batched timeline read may name.
 *
 * Mirrors BOTH hub ceilings — `EVENT_DENSITY_BATCH_MAX` (pipeline-analytics)
 * and `RECORDING_TIMELINE_BATCH_MAX` (recording) — which are the same number on
 * purpose. One constant here rather than two: a scope is asked of all three
 * batches with the same id list, so a client that split the ceiling per method
 * would be asking three different questions about the same wall.
 */
export const TIMELINE_SCOPE_BATCH_MAX = 200

/**
 * The cameras one timeline read covers: the route camera alone, or the view.
 *
 * A bare number rather than `[id]` for the single case is not sugar — it is
 * what keeps the query key numeric (`scopeQueryKey`), so camera-detail's cache
 * entries are the SAME entries they were before the scope existed and a screen
 * with no view behaves identically to the one that shipped.
 */
export type TimelineScope = number | readonly number[]

/** The scope as a list, in the caller's order (never sorted — see
 *  {@link planScopeAsk} for why order is load-bearing). */
export function scopeToIds(scope: TimelineScope): readonly number[] {
  return typeof scope === 'number' ? [scope] : scope
}

/**
 * The scope as a stable string, in CALLER ORDER.
 *
 * A React dependency, and the reason it exists is that the id list is a fresh
 * array literal on every render of the screen above: memoising on the array
 * itself reminted four query keys per render, and memoising on
 * `scopeQueryKey` would compare the SORTED set, which is a different question —
 * order decides which camera an overflow drops.
 *
 * Round-tripped through {@link idsFromScopeKey} rather than captured in a ref,
 * so nothing is read during render that the dependency does not name.
 */
export function scopeIdsKey(ids: readonly number[]): string {
  return ids.join(',')
}

/** The inverse of {@link scopeIdsKey}. An empty key is an empty scope, not
 *  `[NaN]` — which is what a naive `split` produces and what would then travel
 *  to the hub as a device id. */
export function idsFromScopeKey(key: string): readonly number[] {
  if (key.length === 0) return []
  return key.split(',').map(Number).filter((n) => Number.isFinite(n))
}

/** A scope split into what one call may carry and what it cannot. */
export interface ScopeAsk {
  /** The ids that ride the request, in the caller's own order. */
  readonly asked: readonly number[]
  /** The ids the ceiling left out. Never silently dropped — they surface in
   *  {@link ScopeKnowledge.unknownIds}. */
  readonly overflow: readonly number[]
}

/**
 * Split a scope at the ceiling.
 *
 * CALLER ORDER is preserved rather than sorted, and that is load-bearing: the
 * scope is seeded primary-first (`initTimelineScope`), so the camera whose
 * player is on screen is the last one an overflow could ever cost. A sorted ask
 * would drop cameras by device id, which is an arbitrary rule the operator
 * cannot predict.
 *
 * Duplicates and non-finite ids are removed BEFORE the count, so a scope that
 * repeats a camera does not spend one of its 200 slots on it.
 */
export function planScopeAsk(ids: readonly number[]): ScopeAsk {
  const unique: number[] = []
  const seen = new Set<number>()
  for (const id of ids) {
    if (!Number.isFinite(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return {
    asked: unique.slice(0, TIMELINE_SCOPE_BATCH_MAX),
    overflow: unique.slice(TIMELINE_SCOPE_BATCH_MAX),
  }
}

/** The hub's per-camera verdict on one batched read. */
export type ScopeRead = 'read' | 'unreadable'

/** One camera's row, reduced to the only two fields this module reasons about.
 *  The payload (`ranges` / `buckets` / `days`) is the caller's business. */
export interface ScopeReadRow {
  readonly deviceId: number
  readonly read: ScopeRead
}

export interface ScopeKnowledgeInput {
  readonly ask: ScopeAsk
  /** The rows that came back. */
  readonly rows: readonly ScopeReadRow[]
  /** The whole call rejected (React Query `isError`) — no row means anything. */
  readonly failed?: boolean
}

/**
 * How much of the scope the surface may speak for.
 *
 *  - `complete` — every camera in scope answered. An empty payload is a claim.
 *  - `partial`  — some answered, some did not. The drawing is a UNION of the
 *                 ones that did, and it must SAY so.
 *  - `none`     — nothing answered. Drawing an empty timeline here is a lie.
 */
export type ScopeVerdict = 'complete' | 'partial' | 'none'

export interface ScopeKnowledge {
  /** Cameras whose payload is real, in ask order. */
  readonly readIds: readonly number[]
  /** Cameras this read cannot speak for: unreadable rows first (in ask order),
   *  then the ones the ceiling left out. */
  readonly unknownIds: readonly number[]
  /** The subset of `unknownIds` that was never asked at all. Reported apart
   *  because the remedy differs: a smaller view, not a healthier hub. */
  readonly overflowIds: readonly number[]
  readonly verdict: ScopeVerdict
}

/**
 * Reduce an ask plus its rows to what may be claimed.
 *
 * Three rules that all say the same thing in different places:
 *
 *  1. A row for a camera nobody asked about cannot make it `read` — the ask is
 *     the authority on membership, not the answer.
 *  2. An asked camera with NO row is unknown. A short answer looks exactly like
 *     a complete one to anything that only reads the rows it got, which is how
 *     a caller that asked for twelve and got eleven never learns that any is
 *     missing.
 *  3. A REJECTED call knows nothing, including about rows that arrived on an
 *     earlier attempt and are still in the cache. `failed` therefore beats the
 *     rows rather than merging with them.
 */
export function resolveScopeKnowledge(input: ScopeKnowledgeInput): ScopeKnowledge {
  const { asked, overflow } = input.ask
  const askedSet = new Set(asked)
  const readSet = new Set<number>()
  if (input.failed !== true) {
    for (const row of input.rows) {
      if (row.read !== 'read') continue
      if (!askedSet.has(row.deviceId)) continue
      readSet.add(row.deviceId)
    }
  }
  const readIds = asked.filter((id) => readSet.has(id))
  const unknownIds = [...asked.filter((id) => !readSet.has(id)), ...overflow]
  const verdict: ScopeVerdict =
    unknownIds.length === 0 ? 'complete' : readIds.length === 0 ? 'none' : 'partial'
  return { readIds, unknownIds, overflowIds: [...overflow], verdict }
}
