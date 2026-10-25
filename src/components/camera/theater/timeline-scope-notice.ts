/**
 * timeline-scope-notice — what the timeline SAYS when it could not read every
 * camera in the view.
 *
 * The dashed rail on the heatmap and the calendar's `partial` line each carry
 * the fact for one surface. This is the sentence: one line, under the fault
 * band, in the same chrome slot as `TimelineHistoryNotice` and for the same
 * reason — it is not a failure. Nothing rejected, nothing to retry, and a red
 * alert grammar for "two of your six cameras did not answer" would teach the
 * operator to ignore the band on the day something really breaks.
 *
 * Two causes, and they are told apart because the remedies are opposite:
 *
 *  - UNREADABLE — the hub answered `read: 'unreadable'` for those cameras. The
 *    remedy is on the hub (a location remounted, a node brought back).
 *  - OVER THE CEILING — the view named more cameras than one batch may carry
 *    (`TIMELINE_SCOPE_BATCH_MAX`), so they were never asked. The remedy is a
 *    smaller view. Reporting this as "unreadable" would send the operator
 *    hunting a fault that does not exist; reporting it as nothing at all is the
 *    silent truncation both hub schemas refuse to perform.
 *
 * Pure — every rule asserted by value in `__tests__/timeline-scope-notice.spec.ts`.
 */

/** Which sentence the notice shows. `none` renders nothing at all. */
export type ScopeNoticeKind = 'none' | 'unreadable' | 'overflow' | 'both'

export interface ScopeNoticeInput {
  /** Cameras the reads could not speak for — unreadable rows AND overflow. */
  readonly unknownIds: readonly number[]
  /** The subset of those that was never asked, being over the ceiling. */
  readonly overflowIds: readonly number[]
}

export interface ScopeNotice {
  readonly kind: ScopeNoticeKind
  /** Cameras that were asked about and could not be read. */
  readonly unreadableCount: number
  /** Cameras the ceiling left out. */
  readonly overflowCount: number
}

const NO_NOTICE: ScopeNotice = { kind: 'none', unreadableCount: 0, overflowCount: 0 }

/**
 * Reduce what the reads reported into the one line the timeline shows.
 *
 * `unknownIds` is a superset of `overflowIds` by construction
 * (`resolveScopeKnowledge` appends the overflow to the unknowns), so the
 * unreadable count is the difference — computed by SET, not by subtracting
 * lengths, because a caller that unions two reads' unknowns may repeat an id.
 */
export function resolveScopeNotice(input: ScopeNoticeInput): ScopeNotice {
  const overflow = new Set(input.overflowIds)
  const unknown = new Set(input.unknownIds)
  const unreadableCount = [...unknown].filter((id) => !overflow.has(id)).length
  const overflowCount = [...overflow].filter((id) => unknown.has(id)).length
  if (unreadableCount === 0 && overflowCount === 0) return NO_NOTICE
  const kind: ScopeNoticeKind =
    unreadableCount > 0 && overflowCount > 0
      ? 'both'
      : overflowCount > 0
        ? 'overflow'
        : 'unreadable'
  return { kind, unreadableCount, overflowCount }
}

/**
 * The unknowns of every read the timeline runs, as one set.
 *
 * Union rather than intersection: a camera the coverage read missed is missing
 * from the coverage band even if the density read had it, and the notice speaks
 * for the whole surface. Order is preserved and duplicates dropped so the count
 * is cameras, not reads.
 */
export function unionUnknownIds(
  ...groups: readonly (readonly number[])[]
): readonly number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const group of groups) {
    for (const id of group) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
