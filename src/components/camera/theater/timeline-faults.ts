/**
 * timeline-faults — ONE rule for everything in the theater that can fail to
 * load, as a single ordered list.
 *
 * ## What this replaces, and why it is one module
 *
 * The theater grew its fault indicators one defect at a time, and ended up
 * saying the same thing in two different grammars in two different places:
 *
 *   • the STREAM's failure lived inside `TimelinePlaybackBar` — a red reason
 *     string plus a red retry chip crammed into the band's trailing slot, where
 *     it also had to fight the speed selector for the space;
 *   • the EVENTS query's failure lived in `TimelineTracksFaultNotice`, a card
 *     with a red border floating over the scroller;
 *   • RECORDINGS had nothing at all. `useRecordingAvailability` dropped its
 *     `isError` at the call site, so a coverage fetch that failed drew the
 *     exact picture of a camera with no footage.
 *
 * Three failures, two visual languages, one of them invisible. The operator saw
 * a stray red line under the events card and asked, correctly, why the screen
 * has more than one way of saying "this did not load".
 *
 * So the DECISION is here, pure, and there is exactly one place that renders
 * it ({@link TimelineFaultNotice}, docked under the playback bar).
 *
 * ## The two edges worth keeping
 *
 * 1. A dropped socket raises NOTHING. The root hub-status overlay owns that
 *    cause and can explain it, and a retry button wired to a dead socket fails
 *    instantly and reads as a broken control. This was `resolveTracksFault`'s
 *    hard-won rule and it survives here unchanged, now for all three sources.
 * 2. An EMPTY result is not a fault. A quiet camera with no events, and a day
 *    with no footage, both render nothing — a warning on a quiet camera is how
 *    an operator learns to ignore warnings.
 */

/**
 * What failed. Also the render order — see {@link FAULT_PRIORITY}.
 *
 * There is no `clips` source. Clips mode used to have a read of its own
 * (`videoclips.listClips`) and therefore a failure of its own; its cards are now
 * DERIVED from the event clusters and the recording availability this screen
 * already fetches (`clips-from-clusters.ts`), so both of the ways it can fail to
 * load are already reported — as `events` and as `recordings`. A fourth source
 * with no producer would be a signal that can only ever say "fine".
 */
export type FaultSource = 'stream' | 'recordings' | 'events'

/** Failed and idle, or failed with an attempt in flight. */
export type FaultPhase = 'failed' | 'retrying'

/**
 * Priority, most consequential first.
 *
 * The picture beats its metadata: an operator staring at a dead stream does not
 * care that the event list is also stale, and the reverse is not true. Coverage
 * beats events for the same reason — without it the scrubber cannot be trusted,
 * while missing event cards leave the video itself usable.
 */
export const FAULT_PRIORITY: readonly FaultSource[] = [
  'stream',
  'recordings',
  'events',
]

/** One source's health. The three facts the decision needs. */
export interface FaultSignal {
  /** The load is in an error state (React Query's `isError`, or the player's
   *  `error` state). */
  readonly failed: boolean
  /** An attempt is in flight right now (`isFetching`, or reconnecting). */
  readonly fetching: boolean
  /**
   * The reason the failing subsystem gave, when it gave one — only the player
   * does. Null falls back to the source's generic string, because an error with
   * no text reads as a UI glitch rather than as a stream that is down.
   */
  readonly reason: string | null
}

/** Every source's health, keyed so no source can be forgotten by a caller. */
export type TimelineFaultSignals = Readonly<Record<FaultSource, FaultSignal>>

export interface TimelineFaultsInput {
  /** The hub socket is up. */
  readonly connected: boolean
  readonly sources: TimelineFaultSignals
  /** Sources the operator waved away; see {@link pruneDismissals}. */
  readonly dismissed: readonly FaultSource[]
}

/** One row of the notice. */
export interface TimelineFault {
  readonly source: FaultSource
  readonly phase: FaultPhase
  readonly reason: string | null
}

/**
 * What the notice should render, in the order it should render it.
 *
 * Concurrent faults STACK rather than alternate: alternating hides a fault the
 * operator has not read yet behind one they have, and the whole point of the
 * unification is that there is nowhere else to look.
 */
export function resolveTimelineFaults(input: TimelineFaultsInput): readonly TimelineFault[] {
  if (!input.connected) return []
  const faults: TimelineFault[] = []
  for (const source of FAULT_PRIORITY) {
    const signal = input.sources[source]
    if (!signal.failed) continue
    if (input.dismissed.includes(source)) continue
    faults.push({
      source,
      phase: signal.fetching ? 'retrying' : 'failed',
      reason: signal.reason,
    })
  }
  return faults
}

/**
 * Which sources are failing right now, dismissals and connectivity ignored.
 *
 * Separate from {@link resolveTimelineFaults} because the dismissal bookkeeping
 * must not itself be filtered by the dismissals it is reconciling.
 */
export function activeFaultSources(sources: TimelineFaultSignals): readonly FaultSource[] {
  return FAULT_PRIORITY.filter((source) => sources[source].failed)
}

/**
 * Drop dismissals whose source has recovered — the auto-clear.
 *
 * A dismissal is "I have read this one", not "never tell me again": once the
 * retry lands, the source is healthy and its dismissal is spent, so the NEXT
 * failure of that same source raises the notice again.
 *
 * Returns the SAME array when nothing changed. This feeds a `setState` inside an
 * effect, and a fresh array on every render is an infinite loop.
 */
export function pruneDismissals(
  dismissed: readonly FaultSource[],
  stillFailing: readonly FaultSource[],
): readonly FaultSource[] {
  const kept = dismissed.filter((source) => stillFailing.includes(source))
  return kept.length === dismissed.length ? dismissed : kept
}
