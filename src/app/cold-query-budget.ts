/**
 * How many lines the cold-start query trace may spend.
 *
 * ## Why a trace bounded in time still needed one
 *
 * `attachColdQueryTrace` already stops after 30 s, which is the right window:
 * a cold start is the thing it explains. But inside that window it wrote a
 * line per query START and per SUCCESS, and a cold start fires hundreds of
 * queries. Measured on the operator's phone 2026-09-09, six launches in two
 * hours: 2 748 `cold-query` lines, up to 782 from ONE launch — 29% of every
 * client line the app shipped that afternoon.
 *
 * `cold-query` is in `ALWAYS_SHIP_SCOPES`, whose docblock justifies that
 * exemption with "low-rate and bounded — a handful of lines per launch". 782
 * is not a handful, and these lines go to a hub already measured at 70–95%
 * main thread.
 *
 * ## Why a head cap and not sampling
 *
 * Sampling is right for a stream that never ends (that is what
 * `snapshot-paint-log.ts` does for paints). A cold start is not a stream: it
 * is one burst with a beginning, and the beginning is the part that answers
 * "what was slow when the app opened". Taking the first N keeps the queries in
 * the order they were issued — a sampled trace would show a tenth of the
 * sequence and no sequence at all.
 *
 * The tail is not silently dropped: crossing the cap emits ONE line saying how
 * many followed, so a reader can tell a bounded trace from a trace that ended.
 */

/** Lines the trace may write before it summarises the rest. */
export const COLD_QUERY_MAX_LINES = 60

/** What the trace should do with one candidate line. */
export type ColdQueryVerdict = 'log' | 'summarise' | 'drop'

export interface ColdQueryBudget {
  /** Verdict for one line. `summarise` is returned exactly once. */
  readonly admit: () => ColdQueryVerdict
  /** How many lines the budget has withheld so far, the summary one included. */
  readonly suppressed: () => number
}

/** Build a budget. Stateful: it counts. */
export function createColdQueryBudget(max: number = COLD_QUERY_MAX_LINES): ColdQueryBudget {
  let written = 0
  let withheld = 0
  return {
    admit: (): ColdQueryVerdict => {
      if (written < max) {
        written += 1
        return 'log'
      }
      withheld += 1
      return withheld === 1 ? 'summarise' : 'drop'
    },
    suppressed: (): number => withheld,
  }
}
