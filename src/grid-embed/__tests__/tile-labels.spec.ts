/**
 * The wall's words: that both languages have every one of them, and that the
 * app and the page are talking about the SAME set.
 *
 * The design that put the strings in the injected config bought one thing —
 * a single set of translations, in `locales/`, reviewed like every other string
 * — and bought it at the price of a contract between two separately-built
 * artifacts. This file is that contract. A label added to the page and not
 * here, or here and not in one of the two locales, is exactly the drift the
 * design exists to prevent, so it is a failing test rather than a convention.
 *
 * Importing the page's own module is the established way to hold a two-artifact
 * contract still here (`components/__tests__/audio-meter-parity.spec.ts` does
 * the same for the overlay config).
 */
import { describe, expect, it } from 'vitest'

import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'
import { TILE_LABEL_I18N, buildTileLabels } from '../tile-labels.js'
import {
  DEFAULT_TILE_LABELS,
  TILE_LABEL_KEYS,
  resolveTileLabels,
} from '../../../embed/src/embed/tile-labels.js'

/** Resolve a dotted key against a locale document, or `undefined`. */
function lookup(doc: unknown, key: string): string | undefined {
  let node: unknown = doc
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

describe('the app and the page name the same labels', () => {
  it('every label the page draws has an app key — none is left untranslated', () => {
    for (const key of TILE_LABEL_KEYS) {
      expect(TILE_LABEL_I18N).toHaveProperty(key)
    }
  })

  it('and the app invents none the page would ignore', () => {
    for (const key of Object.keys(TILE_LABEL_I18N)) {
      expect(TILE_LABEL_KEYS).toContain(key)
    }
  })
})

describe('every key exists in BOTH languages', () => {
  for (const [label, key] of Object.entries(TILE_LABEL_I18N)) {
    it(`${label} — ${key}`, () => {
      // A key missing from one locale is the drift this whole design was
      // chosen to make impossible; i18next would echo the key back onto a
      // button, so it must never reach a build.
      expect(lookup(enLocale, key), `${key} missing from locales/en.json`).toBeTruthy()
      expect(lookup(itLocale, key), `${key} missing from locales/it.json`).toBeTruthy()
    })
  }
})

describe('what the host actually sends', () => {
  /** i18next's own behaviour, reduced to what this builder depends on: a key
   *  with no translation comes back as the key. */
  const translator = (doc: unknown) =>
    ((key: string) => lookup(doc, key) ?? key) as unknown as Parameters<typeof buildTileLabels>[0]

  it('the English build says exactly what the page already says on its own', () => {
    // The point of the fallback: an unlabelled page and an English-labelled one
    // are the same wall. If these ever disagree, one of the two is stale.
    expect(buildTileLabels(translator(enLocale))).toEqual({ ...DEFAULT_TILE_LABELS })
  })

  it('the Italian build reaches the page as Italian, with nothing left behind', () => {
    const resolved = resolveTileLabels(buildTileLabels(translator(itLocale)))
    for (const key of TILE_LABEL_KEYS) {
      // Asserted against the LOCALE, not "differs from English": `PTZ` is the
      // same word in both, and a test that demanded a difference would be
      // asking for a wrong translation.
      expect(resolved[key], `${key} did not reach the page`).toBe(
        lookup(itLocale, TILE_LABEL_I18N[key]),
      )
    }
  })

  it('omits a key with no translation rather than sending the key itself', () => {
    // i18next echoes an unknown key back. Sending `v2.gridTile.open` would put
    // a raw key on a button; declining lets the page use its English.
    const sent = buildTileLabels(translator({}))
    expect(sent).toEqual({})
    expect(resolveTileLabels(sent)).toEqual(DEFAULT_TILE_LABELS)
  })
})
