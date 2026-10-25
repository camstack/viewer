/**
 * clips-status — what the clip surface SAYS when it has no cards to show.
 *
 * ## The defect this exists to remove
 *
 * `useCameraClips` used to call `capQuery` with no `rethrow`, so React Query
 * recorded a SUCCESS with an empty array for every failure — `cap-query.ts`
 * says it in its own words: "an unreadable day is painted as an empty one".
 * The scroller had no empty branch either, so SIX different situations drew the
 * identical blank body:
 *
 *   • the read failed                • the hub has no `videoclips` cap
 *   • the read hit its deadline      • the socket is down
 *   • the camera was genuinely quiet
 *
 * (`listClips` used to be `auth: 'admin'` and this header used to list that as
 * a sixth cause. It is `protected`, which is what makes a clip surface reachable
 * from a viewer session at all.)
 *
 * ## The distinction this was one short of
 *
 * The four states above cannot tell *"the source answered and holds nothing"*
 * from *"the source could not answer"*. `listSources` measures exactly that,
 * per source, and four of its five states mean the list may NOT be read as
 * complete (D561): 618 says `index-empty` with 177 GB free, 640 said
 * `no-storage` with no card fitted, a standalone battery camera says
 * `sleeping`, a child that threw says `unreachable`. All four used to render as
 * "no clips for this camera" — the sentence this whole line of work exists to
 * stop showing. They are `silent` now, and the row's own reason is rendered
 * beside it, verbatim.
 *
 * The operator cannot act on a blank. They can act on "offline", on "retry",
 * and they can stop looking on "no clips".
 *
 * ## Why the failure renders NOTHING here
 *
 * The theater has exactly one grammar for "this did not load": the band under
 * the playback bar (`timeline-faults.ts` → `TimelineFaultNotice`), which owns
 * the retry and the dismissal. That module exists precisely because the screen
 * once said the same thing in three places in two visual languages. So a failed
 * clip read is reported THERE, as the `clips` fault source, and this resolver
 * returns `'failed'` only so the body can stay quiet on purpose rather than by
 * omission — see {@link clipsStatusMessageKey}.
 *
 * Pure: no React, no i18n lookup, no theme. It returns a key.
 */

import type { ClipSourceState } from './clip-sources.js'

/**
 * Minimum distance from the top of the body, for the case where the indicator
 * has not been measured yet (`viewportHeight === 0` at first paint). Without it
 * the sentence would hug the edge for one frame.
 */
export const CLIPS_NOTE_MIN_TOP_PX = 16

/**
 * Where the note stands: exactly where the FIRST CARD would.
 *
 * Not centred in the body. A sentence floating in the middle of an empty box
 * describes nothing about the list it stands in for — and the same fix was
 * already made for the events embed's placeholder ("the placeholders expand
 * from the centre and the first row is incomplete", operator, 2026-08-19).
 * The cards begin at the top spacer, which is the readhead's own offset, so
 * that is where the note begins too.
 */
export function clipsNoteTopPx(indicatorOffsetPx: number): number {
  if (!Number.isFinite(indicatorOffsetPx)) return CLIPS_NOTE_MIN_TOP_PX
  return Math.max(CLIPS_NOTE_MIN_TOP_PX, Math.round(indicatorOffsetPx))
}

/** What the body should say in place of cards. */
export type ClipsStatusKind =
  | 'hidden'
  | 'loading'
  | 'failed'
  | 'source-missing'
  | 'silent'
  | 'searching'
  | 'empty'

export interface ClipsStatusInput {
  /** Clips mode is on. Off ⟹ the ordinary event timeline owns the body. */
  readonly active: boolean
  /** The hub socket is up. */
  readonly connected: boolean
  /** A read is in flight (React Query's `isFetching`). */
  readonly loading: boolean
  /** The last read rejected (`isError`). */
  readonly failed: boolean
  /** Clips currently drawable — including a previous window's rows, which the
   *  hook deliberately keeps while a wider one loads. */
  readonly clipCount: number
  /**
   * The state of the source this camera's clips are being read FROM, as
   * `listSources` measured it — or null while nothing has answered.
   *
   * Null is "not yet known", not "fine": before the rows land the body says
   * what it always said (D315). `'ok'` is the one value that licenses `empty`.
   */
  readonly sourceState?: ClipSourceState | null
  /** The stored per-camera pick names a source this camera does not have. */
  readonly chosenMissing?: boolean
  /**
   * The surface is still WIDENING the window by itself — it asked for a day,
   * got nothing, and is walking backwards.
   *
   * This exists because `empty` is a CLAIM: "this camera was quiet". A camera
   * whose current day happens to be empty is not quiet, and saying so sent the
   * operator scrolling by hand to find 21 clips one day back. Absent must
   * never look like nothing (D315), and "not looked far enough yet" is a third
   * thing again.
   *
   * Omitted or false ⟹ exactly the behaviour that shipped.
   */
  readonly searching?: boolean
  /** How far back the walk has reached, and its ceiling — rendered in the
   *  message so a long search is legible rather than a frozen spinner. */
  readonly searchedDays?: number
  readonly maxDays?: number
}

/**
 * Which of the states the body is in.
 *
 * Order is the argument:
 *  1. not in clips mode, or there ARE cards → say nothing. A placeholder drawn
 *     over real content is noise, and the kept previous window is real content.
 *  2. socket down → say nothing here either: that is the CAUSE, and the app's
 *     one hub-status overlay (`HubConnectionOverlay`, at the root) already says
 *     it. A failure or a load reported over a dead connection is the same cause
 *     under a second name, and a retry wired to a dead socket fails instantly
 *     and reads as a broken control.
 *  3. the stored PICK before everything below → an operator looking at a
 *     source the camera no longer has must be told that, not told why some
 *     other source is quiet.
 *  4. a NAMED source state before `failed` → the source refuses BY NAME
 *     (`index-empty`, `sleeping`, `unreachable`, `no-storage`), which makes
 *     the list query report `isError`; consulting `failed` first turned a
 *     settled fact about the camera into a red fault band with a RETRY, and
 *     left this arm unreachable for exactly the case it was written for. On
 *     107 that fact is *"the camera has no enabled RTSP profile — HomeKit has
 *     never recorded it"*: retrying cannot help, and D62's rule applies one
 *     layer up — disabled must never look like broken.
 *  5. failed before loading → React Query reports `isError` AND `isFetching`
 *     together while it retries, and "loading" there erases the failure. A
 *     failure that reaches here is one no source explained: a transport fault,
 *     which is what the band and its retry exist for.
 *  6. loading before empty → an unanswered question is not an answer.
 *  7. `empty` last → it claims the camera was quiet, and only a source that
 *     said `ok` licenses that claim.
 */
export function resolveClipsStatus(input: ClipsStatusInput): ClipsStatusKind {
  if (!input.active) return 'hidden'
  if (input.clipCount > 0) return 'hidden'
  if (!input.connected) return 'hidden'
  if (input.chosenMissing === true) return 'source-missing'
  const state = input.sourceState ?? null
  if (state !== null && state !== 'ok') return 'silent'
  if (input.failed) return 'failed'
  if (input.loading) return 'loading'
  // Before `empty`, and that ORDER is the decision: `empty` claims the camera
  // was quiet, and a surface that is still widening its own window has not
  // finished asking. Only when the walk gives up does the claim become
  // licensed — and then it is a claim about the whole searched span, which is
  // why the message carries the day count.
  if (input.searching === true) return 'searching'
  return 'empty'
}

/**
 * The i18n key the body renders for a state, or null when the body says
 * nothing.
 *
 * `failed` maps to null deliberately: the fault band above is already saying
 * it, in the theater's only grammar for a failure, and with the retry attached.
 * A second red sentence in the body is exactly the duplication `timeline-faults`
 * was created to remove.
 */
export function clipsStatusMessageKey(
  kind: ClipsStatusKind,
  values?: Readonly<Record<string, string | number>>,
): string | null {
  // An `empty` that came out of a completed BACKWARD WALK is a different
  // sentence: it claims nothing happened across the whole searched span, not
  // "in the loaded range". Keyed off the value the caller supplies rather than
  // a second kind, because it is the same STATE said with more precision.
  if (kind === 'empty' && typeof values?.['days'] === 'number' && values['days'] > 1) {
    return 'v2.clips.emptySearched'
  }
  switch (kind) {
    case 'loading':
      return 'v2.clips.loading'
    case 'empty':
      return 'v2.clips.empty'
    case 'searching':
      return 'v2.clips.searching'
    // Both of these are a LEAD-IN. The source's own words for why it cannot
    // answer follow, verbatim — a client that paraphrases a server's prose
    // drifts the first time a word changes (D563).
    case 'silent':
      return 'v2.clips.sourceSilent'
    case 'source-missing':
      return 'v2.clips.sourceMissing'
    case 'failed':
    case 'hidden':
      return null
  }
}
