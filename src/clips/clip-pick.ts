/**
 * clip-pick — the DAY STRIP over a body of files: what it draws, and what a
 * press on it opens.
 *
 * ## Why the strip survives a body with no time axis
 *
 * `clips-surface.ts` is right that a body of FILES is not laid out against
 * cluster time — the cards are a list and no epoch runs down them. It does not
 * follow that the DAY has nothing to say about them: every file the camera
 * wrote carries a wall-clock start, and the operator asked for the strip to
 * stay and to mean the obvious thing — *"la heatmap rimane con i salti verso
 * le clip dove si è cliccato"*.
 *
 * So on that surface the strip is not the recorder's tape. Its bands are the
 * FILES ({@link clipDayCoverage}) and a press opens the file under the finger
 * ({@link clipAtEpoch}) instead of seeking our own footage — which, for these
 * cards, would play the right moment from the wrong source, the one thing
 * `clip-tap.ts` exists to prevent.
 *
 * ## One derivation for the bands and the press
 *
 * Both functions take the SAME list, and the caller passes the list it drew.
 * They are next to each other for that reason: a strip whose bands came from
 * one derivation and whose press resolved against another is the defect this
 * repo already paid for once, in a card label 128 s away from the clip its tap
 * opened (`clipStartByCardId`).
 *
 * ## A press on empty tape lands on the NEXT footage
 *
 * Never on nothing: a control that swallows a press is indistinguishable from
 * an app that hung (`clip-tap.ts`). It is the rule the compressed axis already
 * follows — *"a finger on a gap lands on the next footage, never inside the
 * hole"* (`clipAxisOffsetToEpoch`) — so there is one answer to "I pressed
 * between two clips" in this app rather than two.
 *
 * Pure: no React, no i18n, no network.
 */

import { isPlayable, type Clip } from './clip-model.js'

/**
 * One band on the day strip, in epoch ms.
 *
 * Declared here rather than imported from `HeatmapBar`: this directory is pure
 * and must not depend on a component. Structurally the bar's `CoverageRange`,
 * which is what lets the caller hand these straight to it.
 */
export interface ClipDayBand {
  readonly startMs: number
  readonly endMs: number
}

/**
 * The file the day strip should open for a press at `epochMs`.
 *
 * A clip whose interval CONTAINS the instant always wins. Otherwise the
 * nearest by edge distance, with a tie going to the one that starts later —
 * "the next footage", the same direction the compressed axis resolves a gap
 * in. `null` only when there is nothing playable at all, which is a list with
 * no cards and therefore a press on nothing.
 *
 * Refused rows are skipped rather than returned, for `clipStageStep`'s reason:
 * a press that produces a provider's refusal is a control that fails, where
 * the row's own card already carries the refusal and its words.
 */
export function clipAtEpoch(clips: readonly Clip[], epochMs: number): Clip | null {
  let best: Clip | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const clip of clips) {
    if (!isPlayable(clip)) continue
    if (epochMs >= clip.startMs && epochMs <= clip.endMs) return clip
    const distance =
      epochMs < clip.startMs ? clip.startMs - epochMs : epochMs - clip.endMs
    // `<=` so a tie is won by the clip encountered later in the list. The
    // drawn order is newest-first, so that is the OLDER of two equidistant
    // neighbours — the one the finger would reach by scrolling down, and the
    // "next footage" the gap rule names.
    if (distance <= bestDistance) {
      best = clip
      bestDistance = distance
    }
  }
  return best
}

/**
 * The strip's bands: one per file, in the day's own coordinates.
 *
 * `HeatmapBar` clips these to the day window itself, so a file that started
 * yesterday needs no special case here.
 *
 * An in-progress file contributes the span its catalog row claims, which is
 * NOT its end (`clip-progress.ts`: 592 reported the same `endTime` for eight
 * minutes). That is acceptable for a band and nowhere else — a band that is a
 * little short still points at a file that exists, where a progress bar drawn
 * against the same number is a lie that moves. A zero- or negative-width row
 * is dropped rather than drawn as a hairline at the wrong minute.
 */
export function clipDayCoverage(clips: readonly Clip[]): readonly ClipDayBand[] {
  const out: ClipDayBand[] = []
  for (const clip of clips) {
    if (!isPlayable(clip)) continue
    if (!(clip.endMs > clip.startMs)) continue
    out.push({ startMs: clip.startMs, endMs: clip.endMs })
  }
  return out
}
