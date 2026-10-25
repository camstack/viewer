/**
 * The TRANSLATED event taxonomy handed to the events embed.
 *
 * ## Which world this is
 *
 * A track carries taxonomy IDS — `car`, `contact`, `person` — and the hub's own
 * descriptors carry English labels (`Car`). Translation lives in THIS app:
 * `locales/it.json` has all 69 `eventKind.*` keys, and `eventKindLabel(desc, t)`
 * is how every native surface resolves one.
 *
 * The embed has none of that. It is a hub-served browser bundle with no i18n —
 * the same fact that made its empty / error / retry copy come from the host
 * (`EventsStrings`). So a class name reached the operator in English no matter
 * what language the app was in, and an Italian gallery said `Car` on every
 * vehicle tile.
 *
 * This is the other half of that dictionary: `kind → label`, already translated,
 * sent on the config and re-sent when the language changes.
 *
 * ## Why the hub's descriptors are not the list
 *
 * The dictionary used to be exactly the kinds the hub ADVERTISED for the
 * operator's cameras, and that list is narrower than the classes a feed
 * renders. A camera whose `animal` macro is switched off advertises no animal
 * sub while its history still holds `dog` rows; the batch is slow (4190 ms over
 * 16 cameras, measured) and can fail; a raw audio classifier label is in no
 * descriptor at all. Every one of those printed the raw id — `dog` on an
 * Italian gallery, with `Cane` sitting unused in `it.json`.
 *
 * So the dictionary is SEEDED from the catalogs the app already carries
 * (`event-label-vocabulary`, which owns the class → macro → raw rule) and the
 * descriptors are layered ON TOP — they still win when the hub knows a kind
 * this build does not.
 *
 * ## What is NOT in here
 *
 *  - a tier-2 value (a recognised face, a plate read). It is a proper noun and
 *    the embed renders it verbatim — running a person's name through a class
 *    dictionary mangles it, which is why `trackTitle` splits the tiers here too.
 *  - a device name. Those ride `deviceNames`, keyed by id.
 *  - anything in a SHARE URL. A link is handed to someone else, whose language
 *    is not the sender's.
 */

import {
  eventLabelVocabulary,
  resolveEventLabelText,
  type KindTranslationFn,
} from '../data/event-label-vocabulary.js'

/** The descriptor fields a label is derived from — structural, so any caller
 *  with these two can build the dictionary (and the test needs no fixture). */
export interface LabelledEventKind {
  readonly kind: string
  /** i18n key (`eventKind.car`). */
  readonly labelKey: string
  /** The hub's own English label — the fallback when the key is untranslated. */
  readonly label: string
}

export type { KindTranslationFn }

/**
 * `{ '<kind>': '<translated label>' }` for every class the app or the hub
 * knows. Pure.
 *
 * The catalog seed comes first and the descriptors are merged over it, so:
 *
 *  - a class the catalogs know reads in the operator's language whether or not
 *    the hub advertised it, and whether or not the taxonomy query ever answers;
 *  - a kind the hub learns TOMORROW still arrives — with the hub's own English
 *    label, because a key an i18n backend echoes back unchanged
 *    (react-i18next's default for a missing key) is treated as NO translation.
 *    That is the same rule `eventKindLabel` applies, restated here rather than
 *    imported so this module stays free of the lucide glyph dictionary;
 *  - an undefined descriptor list (the taxonomy still in flight) no longer
 *    yields an EMPTY dictionary. It used to, so that half a dictionary could
 *    not pin English onto whichever kinds arrived first; the seed is not half a
 *    dictionary but the whole catalog, already in the right language.
 */
export function kindLabelsFromDescriptors(
  descriptors: readonly LabelledEventKind[] | undefined,
  t: KindTranslationFn,
): Record<string, string> {
  const out: Record<string, string> = eventLabelVocabulary(t)
  if (descriptors === undefined) return out
  for (const descriptor of descriptors) {
    if (descriptor.kind.length === 0) continue
    const translated = t(descriptor.labelKey)
    if (translated !== descriptor.labelKey && translated.length > 0) {
      out[descriptor.kind] = translated
      continue
    }
    // No translation for the descriptor's own key: the catalog rule gets the
    // next word (a macro), and the hub's English label is the last resort
    // rather than the first.
    const resolved = resolveEventLabelText(descriptor.kind, t, descriptor.label)
    if (resolved.length > 0 && resolved !== descriptor.kind) out[descriptor.kind] = resolved
  }
  return out
}
