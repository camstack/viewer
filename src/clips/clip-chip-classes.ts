/**
 * clip-chip-classes — what a clip card is CHIPPED with.
 *
 * ## The operator's report
 *
 * *"continuo a ricevere le clip con label 'native'"*. `native` is an internal
 * value of `Clip.kind`; it is not a word, and it reached the card because two
 * places put `clip.kind` straight into the EVENT-CLASS vocabulary, where it
 * has no entry and therefore renders as itself.
 *
 * ## What `native` actually means, and why it is not a defect upstream
 *
 * `classifyNativeTypes` (server side) demotes the kind to `native` on purpose
 * the moment a row carries a real class: *"A class demotes the motion/audio
 * kind back to `native` — the row is about what it saw, and the kind filter
 * keeps `motion` for rows with nothing else."* So `native` means **"this row
 * has no kind of its own; read the labels"** — and a card that prints it
 * instead of reading the labels is answering the question it was told not to
 * ask.
 *
 * Measured on the live hub, one day, 2026-09-22:
 *
 * | device | rows | `kind: native` | …of those, WITH labels |
 * | --- | --- | --- | --- |
 * | 592 | 285 | 109 | **102** (`person`, `animal`) |
 * | 3628 | 30 | 23 | **23** |
 *
 * So the overwhelming case is a row whose vocabulary was resolved and then
 * dropped. `nativeClipCard` did read the labels; `footageOnlyCard` did not,
 * and used `clip.kind` unconditionally with the labels sitting right beside
 * it.
 *
 * The remaining 7 rows on 592 are `sched` — a scheduled recording, which is
 * the camera saying WHY the file exists and nothing about what is in it. Those
 * chip as `motion`: the operator's rule is *"solamente le classi, motion se
 * altro"*, and a file the camera chose to record is a file something happened
 * in. `motion` is the weakest true thing that can be said about it.
 *
 * Pure: no React, no i18n, no network. It returns CLASS TOKENS, which the card
 * renders through the same event vocabulary every other card uses.
 */
import type { Clip } from './clip-model.js'

/**
 * What a row falls back to when it resolved no class at all.
 *
 * The operator's rule, 2026-09-22: *"native non ha senso. Si deve mostrare
 * solamente le classi, motion se altro"*. A file the camera chose to record is
 * a file something happened in; `motion` is the weakest true thing that can be
 * said about it, and it is a word rather than an identifier.
 *
 * This replaces an earlier answer of mine — show NO chip for such a row — which
 * was defensible and not what was asked for. A card with no pill reads as a
 * card still loading one.
 */
const FALLBACK_CLASS = 'motion'

/**
 * The class tokens a clip card is chipped with, most dominant first.
 *
 * Labels win whenever there are any: they are the hub's RESOLVED vocabulary,
 * the same one every other card on the timeline is chipped with, and the
 * server has already ordered them dominant-first and capped them.
 *
 * `audio` survives as itself, and that is the one judgement call in here: a
 * `cry` is not motion, and calling it motion would be the same crime in the
 * other direction — an answer the row does not support. Every other kindless
 * row, `native` included, is {@link FALLBACK_CLASS}.
 *
 * NEVER empty, and never `native`. A clip is always from a single provider
 * (D554, D569), so there is no second vocabulary to reconcile and no reason a
 * card should be unable to say anything.
 */
export function clipChipClasses(clip: Clip): readonly string[] {
  const labels = clip.labels ?? []
  if (labels.length > 0) return [...labels]
  return clip.kind === 'audio' ? ['audio'] : [FALLBACK_CLASS]
}

/** The ONE class a card shows when it can show only one (`className`). */
export function clipChipClass(clip: Clip): string {
  return clipChipClasses(clip)[0] ?? FALLBACK_CLASS
}
