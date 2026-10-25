/**
 * The reel's words, and the ONE property the whole design rests on: a page that
 * is told nothing keeps speaking English.
 *
 * Same design as the wall's `tile-labels` — the app owns the translations, it
 * has already resolved the operator's language and it has `locales/{en,it}.json`.
 * A second set of strings living in here would be a set nobody checks, and drift
 * between two sets is the ordinary way one string stays behind. So the host
 * injects them in the config it already sends at the handshake
 * (`window.__CAMSTACK_EVENTS__`).
 *
 * Which makes the fallback load-bearing, exactly like `kindLabels`: an older
 * host OTA, or an external iframe embedding this page with a config of its own,
 * sends no labels at all. It must degrade to the English that shipped — never a
 * raw key, never an empty control.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EVENTS_LABELS,
  EVENTS_LABEL_KEYS,
  eventsLabelsSchema,
  resolveEventsLabels,
} from '../events-labels'

describe('a page that is told nothing', () => {
  it('speaks the English that shipped', () => {
    expect(resolveEventsLabels(undefined)).toEqual(DEFAULT_EVENTS_LABELS)
    expect(resolveEventsLabels({})).toEqual(DEFAULT_EVENTS_LABELS)
  })

  it('and the English is the wording actually on the card today', () => {
    // Pinned by value: these strings are the compatibility contract with every
    // host too old to send any, so changing one is a decision, not a tidy-up.
    // The six pills are lower case because that is how they read on the card
    // today — a tooltip, not a title.
    expect(DEFAULT_EVENTS_LABELS.unassignedFace).toBe('unassigned face')
    expect(DEFAULT_EVENTS_LABELS.reviewed).toBe('reviewed')
    expect(DEFAULT_EVENTS_LABELS.debug).toBe('debug')
    expect(DEFAULT_EVENTS_LABELS.train).toBe('train')
    expect(DEFAULT_EVENTS_LABELS.favourite).toBe('favourite')
    expect(DEFAULT_EVENTS_LABELS.active).toBe('active')
    expect(DEFAULT_EVENTS_LABELS.loadingMore).toBe('Loading more events')
  })

  it('every label a control draws has a default — none can resolve to nothing', () => {
    for (const key of EVENTS_LABEL_KEYS) {
      expect(DEFAULT_EVENTS_LABELS[key].length).toBeGreaterThan(0)
    }
  })
})

describe('a page that IS told', () => {
  it('uses the host words it was given', () => {
    const resolved = resolveEventsLabels({ favourite: 'preferito', active: 'attivo' })
    expect(resolved.favourite).toBe('preferito')
    expect(resolved.active).toBe('attivo')
  })

  it('falls back PER LABEL, so a half-translated host is half English, not broken', () => {
    const resolved = resolveEventsLabels({ favourite: 'preferito' })
    expect(resolved.favourite).toBe('preferito')
    expect(resolved.loadingMore).toBe(DEFAULT_EVENTS_LABELS.loadingMore)
  })

  it('refuses an empty or blank string — a missing translation must not blank a control', () => {
    expect(resolveEventsLabels({ favourite: '', active: '   ' })).toEqual(DEFAULT_EVENTS_LABELS)
  })

  it('refuses a non-string, whatever crossed the bridge', () => {
    const raw = { favourite: 42, active: null } as unknown as Record<string, string>
    expect(resolveEventsLabels(raw)).toEqual(DEFAULT_EVENTS_LABELS)
  })
})

describe('the schema the injected config is validated by', () => {
  it('accepts a partial map', () => {
    expect(eventsLabelsSchema.safeParse({ favourite: 'preferito' }).success).toBe(true)
  })

  it('ignores a key this build does not know, rather than rejecting the config', () => {
    // A NEWER host naming a label this page has no control for must not cost
    // the reel its whole config — the two halves version-skew independently.
    const parsed = eventsLabelsSchema.safeParse({ favourite: 'preferito', somethingLater: 'X' })
    expect(parsed.success).toBe(true)
  })

  it('accepts an EMPTY map — every host that ships today sends none', () => {
    expect(eventsLabelsSchema.safeParse({}).success).toBe(true)
  })
})
