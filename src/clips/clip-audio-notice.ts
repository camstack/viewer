/**
 * clip-audio-notice — the ONE place a silent clip is judged DELIBERATE.
 *
 * > *"L'audio non serve in velocità non 1x!!!"* — the operator, 2026-09-23.
 *
 * ## The rule that made this a module rather than a ternary
 *
 * The broker names seven causes for a clip with no sound (D600, D621). Six of
 * them — `not-negotiated`, `not-offered`, `no-audio-track`,
 * `unsupported-codec`, `codec-mismatch`, `stream-failed` — are permanent facts
 * about the file or about the negotiation that carried it: a camera with no
 * microphone is silent at 1× too, and a stream that broke is broken at every
 * rate. The seventh, `rate`, is the operator's own finger on the speed chip:
 * the broker discards every audio frame while the rate is not 1× because that
 * is what he asked for, and the answer comes back the moment he returns to 1×.
 *
 * That difference is the whole feature. Before D621 a clip silent at 2× and a
 * clip silent because the stream broke were the same `carried: false`, and the
 * viewer drew neither — which is the D391 defect where a branch that ACCEPTS
 * work and produces nothing looks exactly like one that never ran. The hub now
 * says which, and this module is where the viewer decides what to do with the
 * answer: the rate one becomes an affordance, and the other six become
 * NOTHING, because drawing a deliberate silence as a fault is worse than the
 * silence (D62 — a thing that is off must never look broken).
 *
 * ## Why the rate comes from the REPORT
 *
 * The app knows a playback rate of its own: the chip's current selection. It
 * is deliberately not read here. The chip is what was ASKED for; the report is
 * what the broker is actually pacing at, it is re-issued whenever the rate
 * crosses 1×, and the two are apart for as long as the round trip takes. A
 * badge built from the chip would name a rate the sound is not suppressed at
 * during exactly the window the operator is looking at it — and it would be a
 * second authority for a number the hub already sends (D62).
 *
 * ## Why the clip id is a parameter
 *
 * The broker guards the same thing on its side: a report that lands after the
 * pointer has left names a clip nobody is playing. This guard is not a mirror
 * of that one — it is the second half of it. The hub can only refuse to send a
 * report for a clip IT has left; the viewer's stage moves on prev/next without
 * waiting, so a report already in flight arrives against the next file. Drawn
 * there it would blame file N+1 for file N's speed.
 *
 * Pure: no React, no i18n, no network. The SENTENCE and the badge are the
 * caller's (`stream-control-items.ts`); what is decided here is only whether
 * there is anything to say, and at what rate.
 */
import type { ClipAudioReport } from '../recording/recording-messages.js'

/**
 * What to tell the operator about the clip's silence, or `null` for nothing.
 *
 * One arm today, and a union rather than a `number | null` on purpose: the six
 * other reasons exist and will eventually want a sentence of their own, and
 * a bare rate would have no room to say which kind of answer it is.
 */
export type ClipAudioNotice = { readonly kind: 'silent-by-speed'; readonly rate: number } | null

/**
 * Resolve the notice for the clip the stage is holding.
 *
 * @param stageClipId the clip on the stage, or `null` when none is.
 * @param report      the broker's latest `clipAudio`, or `null` before one.
 */
export function resolveClipAudioNotice(
  stageClipId: string | null,
  report: ClipAudioReport | null,
): ClipAudioNotice {
  if (stageClipId === null || report === null) return null
  if (report.clipId !== stageClipId) return null
  // A clip that IS carrying sound has nothing to explain, whatever else the
  // report says.
  if (report.carried) return null
  // The other six are not this badge. They are permanent facts, and this
  // module deliberately renders none of them rather than inventing a fault
  // vocabulary the operator has not asked for.
  if (report.reason !== 'rate') return null
  const { rate } = report
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  // 1× is where the sound PLAYS — the hub's predicate is `rate !== 1`, on both
  // the branch that drops the audio and the branch that reports it. A badge
  // saying "no sound at 1×" would contradict the frame it sits on.
  if (rate === 1) return null
  return { kind: 'silent-by-speed', rate }
}
