/**
 * clip-incomplete-notice — the ONE place the viewer decides whether a clip's
 * replay is worth complaining about.
 *
 * > *"Se cade la sessione cade non fa niente, magari mostriamo un errore dove
 * > mostriamo anche l'errore di stream."* — the operator, 2026-09-24.
 *
 * ## What this is the other half of
 *
 * The Amcrest `/cam/playback` replay hangs up part way through a clip and
 * ffmpeg exits 0 when it does, so until D623 a serve that delivered **12.7 %
 * of its bytes** — 4.26 s of a 69.569 s clip, measured on camera 3836 — was
 * logged `complete` and looked, on this screen, exactly like a clip that
 * played whole. That is the D391 shape at its purest: a branch that ACCEPTS
 * work, produces almost none of it, and is indistinguishable from one that
 * never ran.
 *
 * The hub now measures the delivered media against the catalog row's own
 * window and sends `clipIncomplete` once, when the stream ends. This module is
 * where that answer becomes something to draw.
 *
 * ## Why there is no retry, and why that is a decision
 *
 * There is nothing to retry INTO. The bytes are already at the peer, and a
 * second dial would contend for the camera's single replay lane at exactly the
 * moment that lane is already failing — the provider answers a second dial
 * with `a replay was refused, the camera's slot is held`. The operator was
 * asked and chose saying so. So this resolves a SENTENCE and no action, which
 * is also why it cannot ride `timeline-faults.ts`: every row of that band
 * carries a retry chip, and a retry that must not be pressed is worse than no
 * chip at all (D62 — a control that is not one reads as broken).
 *
 * ## Why this is not an error STATE
 *
 * The clip played. It was short. Moving the playback machine to `error` would
 * tear down a player that is showing a perfectly good four seconds of footage,
 * and the operator would lose the picture in order to be told about the
 * picture. The sentence is chrome; the player is untouched.
 *
 * ## Why the clip id is a parameter
 *
 * `clipIncomplete` arrives ONCE, at the END of the stream — after the whole
 * playback it is about. The operator has therefore had a clip's worth of time
 * to press prev/next or go live, and the report lands regardless. The hub
 * guards the same thing on its side, but it can only refuse to send a report
 * for a clip IT has left; the stage here moves on without waiting, so a report
 * already in flight arrives against the next file. Drawn there it would tell
 * the operator that file N+1 was truncated, which is a lie about a camera
 * read that never happened.
 *
 * ## Why `completeness-unverified` has no arm
 *
 * The provider has a third verdict for "nothing measured". It is a diagnostic
 * about the measurement, not a fact about the footage, and the hub's wire
 * schema refuses it — so it never arrives and there is nothing here to decide
 * about it. An arm for it would be a leftover describing a design that does
 * not exist, which reads as verification and is worse than nothing.
 *
 * Pure: no React, no i18n, no network. The hub's `reason` is already prose and
 * is carried through untouched — the viewer adds no words to a measurement
 * only the hub made.
 */
import type { ClipIncompleteCode, ClipIncompleteReport } from '../recording/recording-messages.js'

/**
 * What to tell the operator about the held clip's replay, or `null` for
 * nothing.
 *
 * `kind` is the hub's code, unchanged: the two are kept apart all the way to
 * the surface because a camera that sent NO media is a different complaint
 * from one that sent some, and folding them would put "the rest of the clip is
 * still on the camera" on a clip that has no rest.
 */
export type ClipIncompleteNotice = {
  readonly kind: ClipIncompleteCode
  /** The hub's sentence, verbatim. */
  readonly reason: string
} | null

/**
 * Resolve the notice for the clip the stage is holding.
 *
 * @param stageClipId the clip on the stage, or `null` when none is.
 * @param report      the hub's latest `clipIncomplete`, or `null` before one.
 */
export function resolveClipIncompleteNotice(
  stageClipId: string | null,
  report: ClipIncompleteReport | null,
): ClipIncompleteNotice {
  if (report === null) return null
  // The report names the clip it is about. Anything else on the stage — a
  // different file, or NO file at all once the operator has gone live — is a
  // different camera read and owes the operator nothing.
  //
  // One comparison, not two: a `stageClipId === null` arm above this would be
  // a gate no test can reach, because a null stage already matches no clip id
  // and every case would return here instead. A guard nothing can fail on
  // reads as verification and arms nothing (measured: disarming it left the
  // suite green).
  if (report.clipId !== stageClipId) return null
  // The sentence is the whole message: there is no generic string behind it,
  // so a blank one would draw an empty band that says a clip failed without
  // saying anything. The validator refuses this too; it is checked again here
  // because this module is what the surface actually asks.
  if (report.reason.trim().length === 0) return null
  return { kind: report.code, reason: report.reason }
}
