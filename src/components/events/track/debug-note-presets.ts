import type { PromptPreset } from '../../ui/confirm.js'

/** Reads one i18n key. Kept local so this module needs no i18next types. */
export type TranslateFn = (key: string) => string

/**
 * The canned reasons offered as checkboxes when a track is marked for debug.
 *
 * These are NOT the analyzer's finding codes. The analyzer answers "what is
 * missing from this track's media" after the fact; a note answers "what did the
 * operator SEE that was wrong", which is the half no query can reconstruct.
 *
 * ## Where the list comes from
 *
 * It was derived, once, from a reading of eleven real notes. It is now STATED
 * by the operator who reviews with it (2026-09-15), in their words and their
 * order, which is a better source than one afternoon's sample.
 *
 *  - `lastFrameBeforeFirst`, `twoSubjectsOneTrack`, `brokenTrack`, `noCrop`,
 *    `neverDetected` and `falsePositive` were dropped with it. Some of them
 *    were never ticked; the rest said the same thing less precisely than the
 *    list above (a crop that is WRONG and a crop that is ABSENT are two
 *    different findings, and `noCrop` blurred them).
 *
 * ## The phrases are the matching key
 *
 * Ticking is derived from the note CONTAINING the phrase, so editing a phrase
 * un-ticks the notes that carry the old wording. That is survivable here and
 * only here: per D353 a note lives and dies with the flag, so nothing older
 * than the current open review set can be affected.
 * A caveat that limits every number above: per D353 a note lives and dies with
 * the flag, so "Analizzata" erases it. The corpus this list can be derived
 * from is destroyed each time the operator finishes a review, and the next
 * reading will again see only what is open that day.
 */
const PRESET_IDS: readonly string[] = [
  'stationaryObject',
  'lateStart',
  'earlyEnd',
  'targetSwapped',
  'edgeCropMirror',
  'betterShotExisted',
  'missingMedia',
  'cropOffTarget',
  'riderNotInKeyframe',
]

/** The checkboxes for the debug-note prompt, in the order they render. */
export function debugNotePresets(t: TranslateFn): readonly PromptPreset[] {
  return PRESET_IDS.map((id) => ({ id, phrase: t(`v2.tracks.debugPreset.${id}`) }))
}
