/**
 * The Library tab's section contract: the former Events tab is now Library, a
 * shell over two subsections (Events + Media). Pure-value tests in the
 * style of `nc-tabs.spec.ts` — the labels are asserted against the SHIPPED
 * locale files, because a segment whose key resolves to nothing renders blank.
 *
 * The section the operator sees as **Media** is keyed `artifacts` internally
 * (2026-09-13 rename): the KEY is the `?section=` value and the `/artifacts`
 * route that bookmarks and deep links already carry, so it is deliberately not
 * renamed — only the label is. These tests assert the two separately, so a
 * future rename of one cannot quietly take the other with it.
 *
 * Exports was a THIRD section until 2026-09-13. It was merged into Artifacts —
 * the two listed the same class of thing (a file on the hub with a camera, an
 * instant and a retention window) and the operator had to know which of two
 * pages a given file had landed on. These tests now hold that merge shut: the
 * segment is gone, its label is gone from both locales, and `?section=exports`
 * is an unknown segment rather than a secret redirect.
 */
import { describe, it, expect } from 'vitest'
import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'
import { FEATURE_FLAGS } from '../../app/feature-flags.js'
import { ALL_VIEWER_FEATURES, NO_VIEWER_FEATURES } from '../../hooks/viewer-features.js'
import {
  DEFAULT_LIBRARY_SECTION,
  LIBRARY_SECTION_LABEL_KEYS,
  LIBRARY_SECTION_ORDER,
  buildLibrarySections,
  librarySectionFromParam,
  librarySectionFromParams,
  librarySectionsFor,
  scenesSectionOffered,
  type LibrarySectionKey,
} from '../library-sections.js'

/** Resolve a dotted i18n key (`v2.library.sections.events`) against a locale tree. */
function lookup(tree: unknown, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node != null && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part]
    }
    return undefined
  }, tree)
  if (typeof value !== 'string') throw new Error(`missing i18n key: ${key}`)
  return value
}

describe('library-sections', () => {
  it('exposes Events, then the media section — and no Exports segment', () => {
    expect(LIBRARY_SECTION_ORDER).toEqual<readonly LibrarySectionKey[]>(['events', 'artifacts'])
  })

  it('defaults to Events, so the tab opens on what the old Events tab showed', () => {
    expect(DEFAULT_LIBRARY_SECTION).toBe('events')
    expect(LIBRARY_SECTION_ORDER[0]).toBe('events')
  })

  it('resolves each segment label through its i18n key', () => {
    const sections = buildLibrarySections((key) => `label:${key}`)
    expect(sections).toEqual([
      { value: 'events', label: `label:${LIBRARY_SECTION_LABEL_KEYS.events}` },
      { value: 'artifacts', label: `label:${LIBRARY_SECTION_LABEL_KEYS.artifacts}` },
    ])
  })

  it('has every label in the English locale, plus the Library nav word', () => {
    const sections = buildLibrarySections((key) => lookup(enLocale, key))
    // The LABEL is Media; the KEY stays `artifacts` (see the module header).
    expect(sections.map((s) => s.label)).toEqual(['Events', 'Media'])
    expect(lookup(enLocale, 'nav.library')).toBe('Library')
    expect(lookup(enLocale, 'v2.library.title')).toBe('Library')
  })

  it('has every label in the Italian locale, plus the Libreria nav word', () => {
    const sections = buildLibrarySections((key) => lookup(itLocale, key))
    expect(sections.map((s) => s.label)).toEqual(['Eventi', 'Media'])
    expect(lookup(itLocale, 'nav.library')).toBe('Libreria')
    expect(lookup(itLocale, 'v2.library.title')).toBe('Libreria')
  })
})

const ADMIN = ALL_VIEWER_FEATURES
const NONE = NO_VIEWER_FEATURES
const ON = { scenesLibrary: true } as const
const OFF = { scenesLibrary: false } as const

describe('the feature sections — each one needs its feature (D921)', () => {
  it('are NEVER in the base LIBRARY_SECTION_ORDER — they are a runtime gate, not a kill switch', () => {
    for (const section of ['review', 'plates', 'scenes', 'retrain'] as const) {
      expect(LIBRARY_SECTION_ORDER).not.toContain(section)
    }
  })

  it('an admin (every feature) sees People, Plates, then Retrain, last', () => {
    expect(librarySectionsFor(ADMIN)).toEqual(['events', 'artifacts', 'review', 'plates', 'retrain'])
  })

  it('a viewer with no feature, or an unanswered session, sees Events and Media only', () => {
    expect(librarySectionsFor(NONE)).toEqual(['events', 'artifacts'])
    expect(librarySectionsFor(NONE, ON)).toEqual(['events', 'artifacts'])
  })

  it.each([
    ['face-assignment', 'review'],
    ['plate-assignment', 'plates'],
    ['retrain', 'retrain'],
  ] as const)('a viewer with only %s sees exactly the %s section', (feature, section) => {
    expect(librarySectionsFor([feature])).toEqual(['events', 'artifacts', section])
    expect(librarySectionFromParam(section, [feature])).toBe(section)
  })

  it.each([
    ['face-assignment', 'review'],
    ['plate-assignment', 'plates'],
    ['retrain', 'retrain'],
  ] as const)('a viewer WITHOUT %s has ?section=%s clamped to Events', (feature, section) => {
    const others = ALL_VIEWER_FEATURES.filter((f) => f !== feature)
    expect(librarySectionsFor(others)).not.toContain(section)
    expect(librarySectionFromParam(section, others)).toBe('events')
    expect(librarySectionFromParams({ section }, others)).toBe('events')
  })

  it('defaults to no feature — a caller that forgets the grant stays safe', () => {
    expect(buildLibrarySections((key) => `label:${key}`).map((s) => s.value)).toEqual(['events', 'artifacts'])
    expect(librarySectionFromParam('review')).toBe('events')
    expect(librarySectionFromParam('plates')).toBe('events')
    expect(librarySectionFromParam('retrain')).toBe('events')
  })

  it('keeps the catalog order whatever order the hub lists the features in', () => {
    expect(librarySectionsFor(['retrain', 'face-assignment'])).toEqual(['events', 'artifacts', 'review', 'retrain'])
  })

  it('resolves every feature section label in both locales', () => {
    expect(buildLibrarySections((key) => lookup(enLocale, key), ADMIN).map((s) => s.label)).toEqual([
      'Events', 'Media', 'People', 'Plates', 'Retrain',
    ])
    expect(buildLibrarySections((key) => lookup(itLocale, key), ADMIN).map((s) => s.label)).toEqual([
      'Eventi', 'Media', 'Persone', 'Targhe', 'Riaddestra',
    ])
  })
})

describe('Scenes — prepared, behind a flag that is OFF, and the scenes feature', () => {
  it('the shipped flag is off, so no session sees the section', () => {
    expect(FEATURE_FLAGS.scenesLibrary).toBe(false)
    expect(librarySectionsFor(ADMIN)).not.toContain('scenes')
    expect(buildLibrarySections((key) => key, ADMIN).map((s) => s.value)).not.toContain('scenes')
  })

  it('flag off hides it from an admin too, and a typed ?section=scenes lands on the default', () => {
    expect(librarySectionsFor(ADMIN, OFF)).not.toContain('scenes')
    expect(librarySectionFromParam('scenes', ADMIN, OFF)).toBeNull()
    expect(scenesSectionOffered(ADMIN, OFF)).toBe(false)
  })

  it('flag on: offered to an admin between Plates and Retrain', () => {
    expect(librarySectionsFor(ADMIN, ON)).toEqual(['events', 'artifacts', 'review', 'plates', 'scenes', 'retrain'])
    expect(librarySectionFromParam('scenes', ADMIN, ON)).toBe('scenes')
  })

  it('flag on: a viewer sees it with the scenes feature and not without', () => {
    expect(librarySectionsFor(['scenes'], ON)).toEqual(['events', 'artifacts', 'scenes'])
    expect(scenesSectionOffered(['scenes'], ON)).toBe(true)
    expect(scenesSectionOffered(['face-assignment', 'plate-assignment', 'retrain'], ON)).toBe(false)
    expect(librarySectionsFor(['face-assignment'], ON)).not.toContain('scenes')
  })

  it('has its label in both locales', () => {
    expect(lookup(enLocale, LIBRARY_SECTION_LABEL_KEYS.scenes)).toBe('Scenes')
    expect(lookup(itLocale, LIBRARY_SECTION_LABEL_KEYS.scenes)).toBe('Scene')
    expect(lookup(enLocale, LIBRARY_SECTION_LABEL_KEYS.retrain)).toBe('Retrain')
    expect(lookup(itLocale, LIBRARY_SECTION_LABEL_KEYS.plates)).toBe('Targhe')
  })
})

describe('librarySectionFromParam', () => {
  it('opens the media section for `?section=artifacts` — the key outlived the label', () => {
    expect(librarySectionFromParam('artifacts')).toBe('artifacts')
    expect(librarySectionFromParam('events')).toBe('events')
  })

  it('treats the merged-away `?section=exports` as unknown, so the tab stays put', () => {
    // NOT redirected to Artifacts: an old link that names a section this build
    // no longer has must leave the operator where they are rather than move the
    // page under them. The STACKED `/exports` route is the alias that still
    // lands on the media — asserted in `library-wiring.spec.ts`.
    expect(librarySectionFromParam('exports')).toBeNull()
  })

  it('ignores anything that is not a section, so a deep link never lands nowhere', () => {
    // `camstack://events?trackId=…` carries no `section` at all: the tab must
    // stay on Events rather than fall through to an unknown segment.
    expect(librarySectionFromParam(undefined)).toBeNull()
    expect(librarySectionFromParam('')).toBeNull()
    expect(librarySectionFromParam('videoclips')).toBeNull()
    // Co-moving track groups were DELETED (D330). `?section=groups` is now an
    // unknown segment like any other — not a clamp, not a hidden section.
    expect(librarySectionFromParam('groups')).toBeNull()
    expect(librarySectionFromParam(['artifacts'])).toBeNull()
  })
})

describe('librarySectionFromParams', () => {
  it('sends a track deep link to Events even while Artifacts is showing', () => {
    // `camstack://events?trackId=…&deviceId=…` is answered by the events page.
    // Landing it on the gallery would swallow the link in silence.
    expect(librarySectionFromParams({ trackId: 'abc', deviceId: '3' })).toBe('events')
    // …and it wins over a stale `section` still sitting in the URL.
    expect(librarySectionFromParams({ section: 'artifacts', trackId: 'abc' })).toBe('events')
  })

  it('honours `?section=artifacts` when no track was linked', () => {
    expect(librarySectionFromParams({ section: 'artifacts' })).toBe('artifacts')
    expect(librarySectionFromParams({ section: 'exports' })).toBeNull()
    expect(librarySectionFromParams({ section: 'groups' })).toBeNull()
  })

  it('asks for no section at all when the link carries neither', () => {
    expect(librarySectionFromParams({})).toBeNull()
    expect(librarySectionFromParams({ trackId: '' })).toBeNull()
  })
})
