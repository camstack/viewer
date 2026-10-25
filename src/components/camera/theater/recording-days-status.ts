/**
 * recording-days-status — what the month calendar is allowed to claim about the
 * days it has NOT successfully read.
 *
 * The date picker draws a dot on every day the hub says has footage. That dot is
 * the operator's whole answer to "which day do I look at", so its ABSENCE is a
 * claim: "nothing was recorded here". `useDaysWithRecordings` used to make that
 * claim on a failure — capQuery swallowed the error to `null`, React Query
 * recorded a SUCCESS holding an empty Set, and a month that could not be read
 * was painted as a month with no footage. Exactly the defect `listTracks`
 * (75bdb68) and `getAvailability` (05da647) were fixed for, one query over.
 *
 * With `{ rethrow: true }` at the call site there is finally an error to react
 * to, and this is the rule for reacting to it. Three states, and the point of
 * the module is that the third one is NOT a silent empty grid:
 *
 *   loading — an attempt is in flight and the dots are not trustworthy yet. The
 *             grid already had this (a spinner), for the same reason.
 *   failed  — every attempt (React Query retries once) is spent. Dots stay
 *             suppressed, and the panel SAYS the month could not be read
 *             instead of letting the grid imply an empty month.
 *   partial — the call SUCCEEDED and some cameras in the view answered
 *             `unreadable`. There is nothing to retry and nothing is in flight,
 *             so neither `loading` nor `failed` fits — and `ready` is a lie,
 *             because the dots are the union of the cameras that answered and
 *             an un-dotted day now means "no footage on SOME of them". This is
 *             the multi-camera state; a single-camera month never reaches it.
 *   ready   — the answer is ours; an un-dotted day is genuinely un-dotted.
 *
 * `fetching` beats `failed` deliberately: while the silent retry runs the honest
 * report is "still trying", not "gave up". A warning that appears for 300 ms and
 * then resolves itself is how an operator learns to ignore warnings. Both beat
 * `partial` for the same reason and one more: a completing retry may yet turn a
 * partial month into a whole one.
 */

/** What the calendar grid may show. */
export type RecordingDaysStatus = 'loading' | 'failed' | 'partial' | 'ready'

export interface RecordingDaysSignal {
  /** The hub socket is up. */
  readonly connected: boolean
  /** React Query's `isError` — every attempt is spent. */
  readonly failed: boolean
  /** React Query's `isFetching` — an attempt (first or retry) is in flight. */
  readonly fetching: boolean
  /**
   * How many cameras in scope this month's answer could not speak for
   * (`ScopeDays.unknownIds`). Optional and defaulting to none, so every
   * single-camera caller keeps today's exact three states.
   */
  readonly unknownCameras?: number
}

export function resolveRecordingDaysStatus(signal: RecordingDaysSignal): RecordingDaysStatus {
  // DISCONNECTED raises nothing here. No attempt can even run, the connection
  // banner already owns that cause and can explain it, and a second, dumber
  // report of the same fact inside the calendar is the mistake
  // `resolveTimelineFaults` exists to stop making.
  if (!signal.connected) return 'ready'
  if (signal.fetching) return 'loading'
  if (signal.failed) return 'failed'
  if ((signal.unknownCameras ?? 0) > 0) return 'partial'
  return 'ready'
}
