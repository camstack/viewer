/**
 * The class vocabulary an operator reads, resolved by RULE rather than by
 * whatever the hub happened to advertise.
 *
 * The defect this covers, reported as *"non sono tradotte molte labels di
 * animali e veicoli"*: `locales/{en,it}.json` has had all 69 `eventKind.*`
 * entries since the taxonomy shipped, and `Cane` / `Camion` were sitting in
 * `it.json` the whole time. What was missing was a PATH to them. Both label
 * surfaces asked the per-device descriptor list first and, when that list did
 * not carry the class (a camera whose `animal` macro is off still stores
 * `dog` tracks; the taxonomy query fails; the query has not settled yet),
 * printed `className` RAW — the module header of `use-event-kind-resolver`
 * says so in as many words: *"a scoped set that omits a class makes its label
 * fall back to the raw English id"*.
 *
 * So the assertions below go through the REAL locale files and NEVER through a
 * descriptor: a rule that needs the hub to have advertised the class first is
 * the defect, not the fix.
 */
import { describe, expect, it } from 'vitest'
import {
  APPLE_SA_TO_MACRO,
  AUDIO_MACRO_LABELS,
  COCO_TO_MACRO,
  EVENT_TAXONOMY,
  MACRO_LABELS,
  YAMNET_TO_MACRO,
} from '@camstack/types/client'
import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'
import {
  eventLabelVocabulary,
  resolveAudioLabelText,
  resolveEventLabelText,
  type KindTranslationFn,
} from '../event-label-vocabulary.js'

/** `t` over a real locale file, with react-i18next's missing-key behaviour:
 *  an unknown key comes back unchanged. */
function translatorFor(locale: Record<string, unknown>): KindTranslationFn {
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

describe('resolveEventLabelText', () => {
  it('translates an animal or vehicle sub with no descriptor in sight', () => {
    // Exactly what the operator photographed: `dog` / `truck` printed raw on an
    // Italian events page because the taxonomy list did not carry them.
    expect(resolveEventLabelText('dog', it_)).toBe('Cane')
    expect(resolveEventLabelText('truck', it_)).toBe('Camion')
    expect(resolveEventLabelText('giraffe', it_)).toBe('Giraffa')
    expect(resolveEventLabelText('motorcycle', it_)).toBe('Motocicletta')
  })

  it('is case-insensitive — a stored class is not guaranteed lower case', () => {
    expect(resolveEventLabelText('Dog', it_)).toBe('Cane')
  })

  it('renders English for an English operator — same path, no special case', () => {
    expect(resolveEventLabelText('dog', en_)).toBe('Dog')
  })

  it('falls back to the MACRO when the class has no key of its own', () => {
    // The package proxies are the live example: `COCO_TO_MACRO` maps
    // suitcase/backpack/handbag onto `package`, and the taxonomy mints no sub
    // for them (it only reverses the vehicle and animal macros). The macro is
    // also the HONEST word: the executor drops the raw class and stores
    // `package`, so naming the bag would claim a distinction nothing keeps.
    expect(resolveEventLabelText('suitcase', it_)).toBe('Pacco')
    expect(resolveEventLabelText('backpack', en_)).toBe('Package')
  })

  it('shows the RAW string for a class nobody has ever translated', () => {
    // Never a bare key, never empty: a class the hub learns tomorrow must stay
    // readable. `eventKind.forklift` echoing back would print an i18n key.
    expect(resolveEventLabelText('forklift', it_)).toBe('forklift')
    expect(resolveEventLabelText('forklift', it_, 'Forklift')).toBe('Forklift')
  })

  it('never invents a word for an empty id, and never returns a key', () => {
    // Nothing in, nothing out — the caller decides whether to draw a chip at
    // all. What must never happen is `eventKind.` reaching a card.
    expect(resolveEventLabelText('', it_)).toBe('')
    expect(resolveEventLabelText('   ', it_)).toBe('   ')
  })
})

describe('resolveAudioLabelText', () => {
  it('translates a bare audio macro through its namespaced key', () => {
    expect(resolveAudioLabelText('dog', it_)).toBe('Cane')
    expect(resolveAudioLabelText('glass_breaking', it_)).toBe('Vetro rotto')
  })

  it('translates a RAW classifier label through its audio macro', () => {
    // YAMNet emits `Bark` / `Meow`; Apple SoundAnalysis emits `dog_bark`.
    // Neither is a product word, and neither will ever get 180 hand-written
    // keys — the macro is the vocabulary the product actually speaks.
    expect(resolveAudioLabelText('Bark', it_)).toBe('Cane')
    expect(resolveAudioLabelText('Meow', it_)).toBe('Gatto')
    expect(resolveAudioLabelText('dog_bark', it_)).toBe('Cane')
    expect(resolveAudioLabelText('Police car (siren)', it_)).toBe('Sirena')
  })

  it('keeps the heard and the seen apart', () => {
    // `water` heard is a running tap; `water` seen is a leak sensor. The audio
    // reading must go through `audio-water`, never the sensor's `flood`.
    expect(resolveAudioLabelText('water', it_)).toBe('Acqua')
    expect(resolveAudioLabelText('water', en_)).toBe('Water')
  })

  it('falls back to the BARE label, never the namespaced id', () => {
    expect(resolveAudioLabelText('kazoo', it_)).toBe('kazoo')
  })
})

describe('the vocabulary covers every class the hub catalogs know', () => {
  const catalogIds: readonly string[] = [
    ...Object.keys(EVENT_TAXONOMY),
    ...Object.keys(COCO_TO_MACRO.mapping),
    ...MACRO_LABELS.map((l) => l.id),
    ...AUDIO_MACRO_LABELS.map((l) => `audio-${l.id}`),
    ...Object.keys(YAMNET_TO_MACRO.mapping).map((l) => `audio-${l.toLowerCase()}`),
    ...Object.keys(APPLE_SA_TO_MACRO.mapping).map((l) => `audio-${l.toLowerCase()}`),
  ]

  it.each(['it', 'en'])('resolves every catalog class in %s', (lang) => {
    const t = lang === 'it' ? it_ : en_
    const unresolved = catalogIds.filter((id) => {
      const text = resolveEventLabelText(id, t)
      return text === id || text.startsWith('eventKind.') || text.length === 0
    })
    expect(unresolved).toEqual([])
  })

  it('hands the embed a dictionary it can look every catalog class up in', () => {
    // The embed has no i18n: it renders `kindLabels[id]`. An id missing from
    // the dictionary is an English word on an Italian gallery.
    const dictionary = eventLabelVocabulary(it_)
    for (const id of catalogIds) {
      expect(dictionary[id] ?? id, `no entry for ${id}`).not.toBe(id)
    }
    expect(dictionary.dog).toBe('Cane')
    expect(dictionary['audio-bark']).toBe('Cane')
  })

  it('is rebuilt per language — the dictionary is not cached across `t`', () => {
    expect(eventLabelVocabulary(en_).dog).toBe('Dog')
    expect(eventLabelVocabulary(it_).dog).toBe('Cane')
  })
})
