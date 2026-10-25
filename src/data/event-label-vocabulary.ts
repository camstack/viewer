/**
 * event-label-vocabulary — the word an operator reads for a detection class,
 * resolved by RULE over the hub's own catalogs.
 *
 * ## The defect this exists for
 *
 * `locales/{en,it}.json` has carried all 69 `eventKind.*` entries since the
 * taxonomy shipped — `Cane`, `Camion`, `Vetro rotto` were all there. What was
 * missing was a PATH to them: both label surfaces asked the per-device
 * descriptor list (`pipelineAnalytics.listEventKindsBatch`) first and printed
 * the class id RAW when that list did not carry the class. Three ordinary ways
 * it does not:
 *
 *  - the camera's `animal` (or `vehicle`) macro is switched OFF in its
 *    detection config, so `composeEventKinds` advertises none of its subs —
 *    while the track history still holds `dog` rows from before, and from
 *    every camera-native provider that reports one;
 *  - the taxonomy query has not settled, or failed. A 16-camera batch was
 *    measured at 4190 ms;
 *  - the class is not a taxonomy kind at all — a raw audio classifier label
 *    (`Bark`, `dog_bark`), or a COCO package proxy.
 *
 * A dictionary of what the hub happened to advertise is therefore the wrong
 * shape for this question. The catalogs are STATIC data in `@camstack/types`,
 * they travel with the app, and they answer it without a round trip.
 *
 * ## The rule
 *
 * For an id, in order, the first that answers:
 *
 *   1. `eventKind.<id>` — the class's own key (tried as given and lower-cased,
 *      because a stored `className` is not guaranteed to match the taxonomy's
 *      case);
 *   2. `eventKind.<macro>` — its macro's key. `COCO_TO_MACRO` for a detection
 *      class, `parentKind` for a taxonomy sub, the audio maps for an
 *      `audio-<label>` id. A macro word is a true statement about the subject,
 *      and it is what the pipeline actually stores for the classes that have
 *      no sub of their own;
 *   3. the caller's English fallback — the hub descriptor's `label`, when the
 *      caller has one and we do not know the class;
 *   4. **the raw string, shown.** Never a bare `eventKind.*` key, never an
 *      empty label. A class nobody has translated must still be readable, and
 *      a class the hub learns tomorrow reaches the operator as itself.
 *
 * ## What is NOT resolved here
 *
 * A tier-2 label — a recognised face, a plate read, a species instance. Those
 * are DATA, not vocabulary: running a person's name or a number plate through
 * a class dictionary mangles it. The two tiers are split by the caller
 * (`resolveRowTitle` in the embed, the card in the app) and only tier 1 and the
 * class ever reach this module.
 */
import {
  APPLE_SA_TO_MACRO,
  AUDIO_MACRO_LABELS,
  COCO_TO_MACRO,
  EVENT_TAXONOMY,
  MACRO_LABELS,
  YAMNET_TO_MACRO,
} from '@camstack/types/client'
import { audioKindId } from './event-kinds.js'

/** Single-key lookup returning a string. Compatible with react-i18next's `t`:
 *  an ABSENT key comes back unchanged, which is how "no translation" is told
 *  apart from a translation that happens to equal its key. */
export type KindTranslationFn = (key: string) => string

/** The i18n namespace every class word lives in. One prefix, declared once. */
const KEY_PREFIX = 'eventKind.'

/** The `audio-` namespace the taxonomy keys audio subs under. */
const AUDIO_PREFIX = 'audio-'

/**
 * `audio-<raw classifier label>` → `audio-<macro>`, from BOTH audio catalogs.
 *
 * Built lower-cased because `audioKindId` lower-cases, and because the two
 * vendors disagree on case by construction (YAMNet `Bark`, Apple `dog_bark`).
 * Raw labels get no keys of their own on purpose: there are ~250 of them, they
 * change with the model, and a hand-written list of them is precisely the thing
 * that rots into English.
 */
const AUDIO_LABEL_TO_MACRO_ID: ReadonlyMap<string, string> = new Map(
  [
    ...Object.entries(YAMNET_TO_MACRO.mapping),
    ...Object.entries(APPLE_SA_TO_MACRO.mapping),
  ].map(([label, macro]) => [audioKindId(label), `${AUDIO_PREFIX}${macro}`]),
)

/**
 * The macro id for a class, or undefined when nothing in the catalogs knows it.
 *
 * The video vocabulary is asked FIRST and the audio vocabulary only for an
 * already-namespaced id: `water` seen (a leak sensor) and `water` heard (a
 * running tap) are different events with the same word, and `dog` is both a
 * COCO class and an audio macro. Namespacing is what keeps the two readings
 * apart, so this function never guesses across it.
 */
function macroIdFor(id: string): string | undefined {
  const lower = id.toLowerCase()
  const taxonomyParent = EVENT_TAXONOMY[id]?.parentKind ?? EVENT_TAXONOMY[lower]?.parentKind
  if (typeof taxonomyParent === 'string' && taxonomyParent.length > 0) return taxonomyParent
  const coco = COCO_TO_MACRO.mapping[lower]
  if (typeof coco === 'string' && coco.length > 0) return coco
  if (lower.startsWith(AUDIO_PREFIX)) return AUDIO_LABEL_TO_MACRO_ID.get(lower)
  return undefined
}

/** A translation, or undefined when the key is absent (react-i18next echoes
 *  the key back) or empty. */
function translated(key: string, t: KindTranslationFn): string | undefined {
  const value = t(key)
  return value === key || value.length === 0 ? undefined : value
}

/**
 * The word to show for a class id. See the module header for the rule.
 *
 * `fallback` is the caller's last-resort English — a hub descriptor's `label`
 * for a class this build has never heard of. Omitted, the id itself is shown.
 */
export function resolveEventLabelText(
  id: string,
  t: KindTranslationFn,
  fallback?: string,
): string {
  const trimmed = id.trim()
  if (trimmed.length === 0) return id
  const lower = trimmed.toLowerCase()
  const own = translated(`${KEY_PREFIX}${trimmed}`, t) ?? translated(`${KEY_PREFIX}${lower}`, t)
  if (own !== undefined) return own
  const macro = macroIdFor(trimmed)
  const viaMacro = macro === undefined ? undefined : translated(`${KEY_PREFIX}${macro}`, t)
  if (viaMacro !== undefined) return viaMacro
  if (fallback !== undefined && fallback.length > 0) return fallback
  const english = EVENT_TAXONOMY[trimmed]?.label ?? EVENT_TAXONOMY[lower]?.label
  return english ?? trimmed
}

/**
 * The word to show for a BARE audio label (`dog`, `glass_breaking`, `Bark`).
 *
 * Namespaced before the lookup (`audio-dog`) and un-namespaced for the raw
 * fallback: returning `audio-kazoo` for an unmapped label would replace a word
 * the operator recognises with an internal id, which is worse than the defect.
 */
export function resolveAudioLabelText(
  label: string,
  t: KindTranslationFn,
  fallback?: string,
): string {
  const bare = label.trim()
  if (bare.length === 0) return label
  return resolveEventLabelText(audioKindId(bare), t, fallback ?? bare)
}

/** Every id the catalogs know, video and audio, namespaced as it is looked up.
 *  Derived, never hand-listed: a class the catalogs gain joins it by existing. */
function catalogIds(): readonly string[] {
  return [
    ...Object.keys(EVENT_TAXONOMY),
    ...Object.keys(COCO_TO_MACRO.mapping),
    ...MACRO_LABELS.map((l) => l.id),
    ...AUDIO_MACRO_LABELS.map((l) => `${AUDIO_PREFIX}${l.id}`),
    ...AUDIO_LABEL_TO_MACRO_ID.keys(),
  ]
}

/**
 * The whole vocabulary as a plain `{ id: word }` dictionary, for a consumer
 * that cannot call a function.
 *
 * The hub-served EMBED is that consumer: it lives in a WebView / iframe, has no
 * i18n of its own by design (see `embed/src/embed/events-labels.ts`), and looks
 * a class up in the dictionary the host injects. So the rule above has to be
 * APPLIED here and handed over already resolved.
 *
 * An id whose word is the id itself is omitted: the embed's `kindLabelFor`
 * falls back to the raw id anyway, so the entry would carry no information and
 * only weight on a config that is re-sent on every language change.
 */
export function eventLabelVocabulary(t: KindTranslationFn): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of catalogIds()) {
    if (out[id] !== undefined) continue
    const text = resolveEventLabelText(id, t)
    if (text === id) continue
    out[id] = text
  }
  return out
}
