/**
 * The TRANSLATED taxonomy handed to the events embed.
 *
 * The defect this covers: the embed has NO i18n, so a card rendered the hub's
 * English label — `Car` on an Italian gallery, which the operator photographed.
 * It was never a missing key: `locales/it.json` has all 69 `eventKind.*`
 * entries and has had them since the taxonomy shipped. It was a path that never
 * asked the translator, exactly like `EventKindTree`'s fallback branch that
 * rendered the raw class instead of `eventKindLabel(...)`.
 *
 * So the assertions below go through the REAL Italian locale rather than a
 * stub: a test that only proved "a function was called" would have passed on
 * the day the surface was broken.
 */
import { describe, expect, it } from 'vitest'
import itLocale from '../../../locales/it.json'
import enLocale from '../../../locales/en.json'
import { kindLabelsFromDescriptors, type LabelledEventKind } from '../kind-labels.js'

/** `t` over a real locale file, with react-i18next's missing-key behaviour:
 *  an unknown key comes back unchanged. */
function translatorFor(locale: Record<string, unknown>): (key: string) => string {
  return (key) => {
    const parts = key.split('.')
    let node: unknown = locale
    for (const part of parts) {
      if (typeof node !== 'object' || node === null) return key
      node = (node as Record<string, unknown>)[part]
    }
    return typeof node === 'string' ? node : key
  }
}

const it_ = translatorFor(itLocale as unknown as Record<string, unknown>)
const en_ = translatorFor(enLocale as unknown as Record<string, unknown>)

const kind = (k: string, label: string): LabelledEventKind => ({
  kind: k,
  labelKey: `eventKind.${k}`,
  label,
})

describe('kindLabelsFromDescriptors', () => {
  it('renders the ITALIAN taxonomy, not the hub’s English labels', () => {
    // `Car` is the exact string the operator saw on an Italian gallery.
    const labels = kindLabelsFromDescriptors(
      [kind('car', 'Car'), kind('person', 'Person'), kind('contact', 'Contact')],
      it_,
    )
    expect(labels).toMatchObject({ car: 'Auto', person: 'Persona', contact: 'Contatto' })
  })

  it('renders English for an English host — same path, no special case', () => {
    expect(kindLabelsFromDescriptors([kind('car', 'Car')], en_).car).toBe('Car')
  })

  it('falls back to the hub label when the key is UNTRANSLATED', () => {
    // A kind the hub learns tomorrow has no `eventKind.*` entry here yet.
    // react-i18next echoes the key back; echoing it onto a card would print
    // `eventKind.forklift` to an operator.
    const labels = kindLabelsFromDescriptors([kind('forklift', 'Forklift')], it_)
    expect(labels.forklift).toBe('Forklift')
  })

  it('still speaks Italian while the taxonomy query has not settled', () => {
    // It USED to be empty here, on the reasoning that half a dictionary pins
    // English onto whichever kinds arrive first. The seed is not half a
    // dictionary: it is the whole catalog, resolved through the operator's own
    // locale, and it needs no round trip. A 16-camera batch was measured at
    // 4190 ms — that is 4 s of raw `dog` on the gallery, plus forever if the
    // query fails.
    const labels = kindLabelsFromDescriptors(undefined, it_)
    expect(labels.dog).toBe('Cane')
    expect(labels.truck).toBe('Camion')
  })

  it('translates a class the descriptors DO NOT carry', () => {
    // The live shape of the defect: a camera whose `animal` macro is off
    // advertises no animal sub, while its history still holds `dog` tracks.
    // Only `car` is advertised here — `dog` must still read `Cane`.
    const labels = kindLabelsFromDescriptors([kind('car', 'Car')], it_)
    expect(labels.car).toBe('Auto')
    expect(labels.dog).toBe('Cane')
    expect(labels['audio-glass_breaking']).toBe('Vetro rotto')
  })

  it('lets a raw classifier label reach the operator through its macro', () => {
    // The embed looks an audio label up namespaced (`audioKindId`). YAMNet's
    // `Bark` will never have a key of its own, and must not print raw.
    expect(kindLabelsFromDescriptors(undefined, it_)['audio-bark']).toBe('Cane')
  })

  it('keeps the hub’s English for a kind this build has never heard of', () => {
    // The seed must not shadow a NEW hub kind with silence: an id the catalogs
    // do not know still takes the descriptor's own label.
    expect(kindLabelsFromDescriptors([kind('forklift', 'Forklift')], it_).forklift).toBe(
      'Forklift',
    )
  })
})
