/**
 * The page's words, and the ONE property the whole design rests on: a page that
 * is told nothing keeps speaking English.
 *
 * The app owns the translations — it has already resolved the operator's
 * language and it has `locales/{en,it}.json`. A second set of strings living in
 * here would be a set nobody checks, and drift between two sets is the ordinary
 * way one string stays behind. So the host injects them in the config it
 * already sends at the handshake.
 *
 * Which makes the fallback load-bearing, exactly like `setSpans`: an older host
 * OTA, or an external iframe embedding this page with a config of its own, sends
 * no labels at all. It must degrade to the English that shipped — never a raw
 * key, never an empty control.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TILE_LABELS,
  TILE_LABEL_KEYS,
  resolveTileLabels,
  tileLabelsSchema,
} from '../tile-labels'

describe('a page that is told nothing', () => {
  it('speaks the English that shipped', () => {
    expect(resolveTileLabels(undefined)).toEqual(DEFAULT_TILE_LABELS)
    expect(resolveTileLabels({})).toEqual(DEFAULT_TILE_LABELS)
  })

  it('and the English is the wording actually on the wall today', () => {
    // Pinned by value: these strings are the compatibility contract with every
    // host too old to send any, so changing one is a decision, not a tidy-up.
    expect(DEFAULT_TILE_LABELS.open).toBe('Open')
    expect(DEFAULT_TILE_LABELS.ptz).toBe('PTZ')
    expect(DEFAULT_TILE_LABELS.moreActions).toBe('More actions')
    expect(DEFAULT_TILE_LABELS.removeFromView).toBe('Remove from view')
    expect(DEFAULT_TILE_LABELS.resizeWidth).toBe('Resize width')
    expect(DEFAULT_TILE_LABELS.resizeHeight).toBe('Resize height')
  })

  it('every label a control draws has a default — none can resolve to nothing', () => {
    for (const key of TILE_LABEL_KEYS) {
      expect(DEFAULT_TILE_LABELS[key].length).toBeGreaterThan(0)
    }
  })
})

describe('a page that IS told', () => {
  it('uses the host words it was given', () => {
    const resolved = resolveTileLabels({ open: 'Apri', ptz: 'PTZ', removeFromView: 'Togli' })
    expect(resolved.open).toBe('Apri')
    expect(resolved.removeFromView).toBe('Togli')
  })

  it('falls back PER LABEL, so a half-translated host is half English, not broken', () => {
    const resolved = resolveTileLabels({ open: 'Apri' })
    expect(resolved.open).toBe('Apri')
    expect(resolved.moreActions).toBe(DEFAULT_TILE_LABELS.moreActions)
  })

  it('refuses an empty or blank string — a missing translation must not blank a control', () => {
    expect(resolveTileLabels({ open: '', ptz: '   ' })).toEqual(DEFAULT_TILE_LABELS)
  })

  it('refuses a non-string, whatever crossed the bridge', () => {
    const raw = { open: 42, moreActions: null } as unknown as Record<string, string>
    expect(resolveTileLabels(raw)).toEqual(DEFAULT_TILE_LABELS)
  })
})

describe('the schema the injected config is validated by', () => {
  it('accepts an absent map — every grid that ships sends none', () => {
    expect(tileLabelsSchema.safeParse(undefined).success).toBe(true)
  })

  it('accepts a partial map', () => {
    expect(tileLabelsSchema.safeParse({ open: 'Apri' }).success).toBe(true)
  })

  it('ignores a key this build does not know, rather than rejecting the config', () => {
    // A NEWER host naming a label this page has no control for must not cost
    // the wall its whole config — the two halves version-skew independently.
    const parsed = tileLabelsSchema.safeParse({ open: 'Apri', somethingLater: 'X' })
    expect(parsed.success).toBe(true)
  })
})
