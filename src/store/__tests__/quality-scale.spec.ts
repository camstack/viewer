/**
 * ONE stream-quality scale, and it is the SYSTEM's.
 *
 * The viewer carried two spellings of one thing: `StreamQuality`
 * (`auto|high|mid|low`, settings + per-camera prefs) and `GridQuality`
 * (`auto|high|medium|low`, per-grid options + the share link + the embed
 * protocol). `medium` was a word no other part of CamStack said — the hub's
 * `CamProfileSchema` is `high|mid|low` everywhere — and `quality-target.ts`
 * translated between them on the way to the broker, which is precisely what let
 * the second spelling survive upstream.
 *
 * The operator settled it on 2026-09-02: *«la scala deve essere unica ed
 * utilizzare la enum di sistema, sempre»*, and *«non serve alcuna migrazione dei
 * valori persistiti»* — a stored value that is no longer a value normalises to
 * the DEFAULT on read, it is not converted.
 *
 * Four claims:
 *
 *  1. the scale IS the system enum plus `auto`, derived rather than retyped;
 *  2. `auto` stays OUTSIDE the system enum — it is not a tier;
 *  3. a wall tier persisted at `'medium'` reads back as the default, at the one
 *     boundary that already normalises (`grid-local-store`), never as `'mid'`;
 *  4. nothing translates on the way to the broker any more.
 */
import { describe, expect, it } from 'vitest'
import { CamProfileSchema } from '@camstack/types/client'

import { isStreamQuality } from '../settings-store.js'
import { parseGrids, resolveGridOptions } from '../grid-store.js'
import { GRID_QUALITY_DEFAULT, parseGridLocalEntry, resolveGridQuality } from '../grid-local-store.js'
import { QUALITY_ORDER, qualityLabelKey } from '../../components/camera/stream-quality-labels.js'
import {
  qualityForRoute,
  qualityToTarget,
  qualityToTargetForRoute,
} from '../../live/quality-target.js'

describe('the scale is the system enum plus auto', () => {
  it('QUALITY_ORDER is exactly `auto` followed by the hub profiles, in hub order', () => {
    // Both halves on purpose. The literal is what the operator sees in the
    // picker, so a silent reordering upstream is caught here rather than in a
    // screenshot; the structural half is what makes "one scale" true rather
    // than merely currently-equal.
    expect(QUALITY_ORDER).toEqual(['auto', 'high', 'mid', 'low'])
    expect(QUALITY_ORDER).toEqual(['auto', ...CamProfileSchema.options])
  })

  it('every system profile is accepted at the storage boundary', () => {
    for (const profile of CamProfileSchema.options) {
      expect(isStreamQuality(profile), profile).toBe(true)
    }
    expect(isStreamQuality('auto')).toBe(true)
  })

  it('`auto` is NOT a member of the system enum — it is the absence of a request', () => {
    expect(CamProfileSchema.options).not.toContain('auto')
    expect(qualityToTarget('auto')).toEqual({ kind: 'adaptive' })
  })

  it('the retired local spelling is not a value anywhere', () => {
    expect(isStreamQuality('medium')).toBe(false)
    expect(QUALITY_ORDER).not.toContain('medium')
    expect(CamProfileSchema.options).not.toContain('medium')
  })

  it('every tier has a label, so the two bars can share one picker', () => {
    for (const tier of QUALITY_ORDER) {
      expect(qualityLabelKey(tier), tier).toMatch(/^v2\.settings\.quality/)
    }
  })
})

describe('a persisted value that is no longer a value', () => {
  // The wall's tier is device-local since the profile split (`grid-local-store`);
  // the normalise-on-read rule moved with it.
  it('a grid stored at `medium` resolves to the DEFAULT, not to `mid`', () => {
    // The operator ruled out migrating. Converting would be a migration by
    // another name — and it would be the one case where a viewer silently
    // decides what an operator meant.
    const entry = parseGridLocalEntry({ quality: 'medium', audioOnIds: [3] })
    expect(resolveGridQuality(entry ?? undefined)).toBe(GRID_QUALITY_DEFAULT)
    expect(resolveGridQuality(entry ?? undefined)).not.toBe('mid')
    // Only that field falls back — the rest of the entry is untouched.
    expect(entry?.audioOnIds).toEqual([3])
  })

  it('junk in the same slot behaves identically — there is no list of past words', () => {
    for (const stored of [42, null, 'ultra', '', {}] as const) {
      expect(resolveGridQuality(parseGridLocalEntry({ quality: stored }) ?? undefined), String(stored)).toBe(
        GRID_QUALITY_DEFAULT,
      )
    }
  })

  it('a valid stored tier still survives a reopen untouched', () => {
    for (const tier of QUALITY_ORDER) {
      expect(resolveGridQuality(parseGridLocalEntry({ quality: tier }) ?? undefined), tier).toBe(tier)
    }
  })
})

describe('a retired tier does not take the GRID with it', () => {
  it('a grid persisted at `medium` still parses — cameras and all', () => {
    // The defect this catches is not cosmetic. `isGridOptions` decides whether
    // the whole grid survives `parseGrids`, and it used to judge the quality
    // VALUE against its own copy of the scale. Retiring `medium` there would
    // have deleted every grid an older build wrote — silently, at the next
    // launch, along with its cameras — instead of falling back to the default
    // tier.
    const stored = JSON.stringify([
      {
        id: 'g1',
        name: 'Piano terra',
        cameraIds: [1, 5, 9],
        audioOnIds: [5],
        options: { quality: 'medium', layout: 3, showName: true },
      },
    ])
    const grids = parseGrids(stored)
    expect(grids).toHaveLength(1)
    expect(grids[0].cameraIds).toEqual([1, 5, 9])
    expect(resolveGridOptions(grids[0].options).showName).toBe(true)
  })

  it('nor does junk in that slot', () => {
    const stored = JSON.stringify([
      { id: 'g1', name: 'Sala', cameraIds: [2], options: { quality: 7 } },
    ])
    expect(parseGrids(stored)).toHaveLength(1)
  })
})

describe('nothing translates on the way to the broker', () => {
  it('a profile is passed through verbatim', () => {
    for (const profile of CamProfileSchema.options) {
      expect(qualityToTarget(profile), profile).toEqual({ kind: 'profile', profile })
    }
  })
})

describe('off the local network the ask is always low', () => {
  it('keeps the preference on LAN and loopback', () => {
    expect(qualityForRoute('high', 'lan')).toBe('high')
    expect(qualityForRoute('auto', 'loopback')).toBe('auto')
    expect(qualityToTargetForRoute('mid', 'lan')).toEqual({ kind: 'profile', profile: 'mid' })
    expect(qualityToTargetForRoute('auto', 'loopback')).toEqual({ kind: 'adaptive' })
  })

  it('pins low on a public or unknown route — never adaptive', () => {
    // Adaptive enters on low then climbs from a probe; pinning prevents the climb.
    for (const channel of ['public', 'unknown'] as const) {
      expect(qualityForRoute('high', channel), channel).toBe('low')
      expect(qualityForRoute('auto', channel), channel).toBe('low')
      expect(qualityToTargetForRoute('high', channel), channel).toEqual({
        kind: 'profile',
        profile: 'low',
      })
      expect(qualityToTargetForRoute('auto', channel), channel).toEqual({
        kind: 'profile',
        profile: 'low',
      })
    }
  })
})
