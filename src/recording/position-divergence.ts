/**
 * position-divergence — turn "the cursor does not match the stream" into a
 * number.
 *
 * The operator reports a drift between the time under the timeline indicator
 * and the time the stream is actually showing. Five candidate causes have been
 * read out of the code and eliminated:
 *
 *   • the server's cursor is paced in WALL time and reports the frame it just
 *     fed (`recorded-feeder.feedOneAu`), so it does not run ahead of playback;
 *   • `topMs` re-reads `Date.now()` every second, so the live edge is not
 *     frozen at mount;
 *   • `epochToOffset` / `offsetToEpoch` are exact inverses;
 *   • the scroller's top spacer IS `indicatorPx`, so the grid position under
 *     the indicator maps back to `activeEpoch`;
 *   • the scroll offset becoming a ref (the re-render fix) feeds no displayed
 *     time — only the visible-cluster window.
 *
 * What none of that can tell us is which of the two numbers is wrong, because
 * nothing ever compared them. This does: it holds the last position the PLAYER
 * reported and the epoch the INDICATOR is drawn at, and logs when they part by
 * more than a tolerance.
 *
 * Pure, so the decision is testable without a renderer. The caller owns the
 * clock and the logging.
 */

/** Below this the two are the same moment — position reports arrive at ~1 Hz
 *  and a frame is ~40 ms, so anything under a couple of seconds is cadence. */
export const DIVERGENCE_TOLERANCE_MS = 2_000

/** How long to wait between reports, so a persistent drift logs once a spell
 *  rather than once per position message. */
export const DIVERGENCE_REPORT_INTERVAL_MS = 10_000

export interface DivergenceInput {
  /** Epoch the timeline indicator is currently drawn at (`activeEpoch`). */
  readonly indicatorEpoch: number | null
  /** Last epoch the PLAYER reported for the frame it is showing. */
  readonly playerEpoch: number | null
  readonly nowMs: number
  /** When the last report was emitted, or null if never. */
  readonly lastReportAt: number | null
}

export interface DivergenceReport {
  readonly deltaMs: number
  /** Positive: the indicator is AHEAD of the stream (showing a later time). */
  readonly indicatorAhead: boolean
}

/**
 * Should this pair be reported, and as what?
 *
 * `null` when there is nothing to say — either number missing, inside
 * tolerance, or reported too recently. Both epochs missing is the normal live
 * case, not a fault.
 */
export function evaluateDivergence(input: DivergenceInput): DivergenceReport | null {
  const { indicatorEpoch, playerEpoch, nowMs, lastReportAt } = input
  if (indicatorEpoch === null || playerEpoch === null) return null
  const delta = indicatorEpoch - playerEpoch
  if (Math.abs(delta) < DIVERGENCE_TOLERANCE_MS) return null
  if (lastReportAt !== null && nowMs - lastReportAt < DIVERGENCE_REPORT_INTERVAL_MS) return null
  return { deltaMs: delta, indicatorAhead: delta > 0 }
}
