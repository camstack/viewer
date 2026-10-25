/**
 * The preset list is copy plus an order — so what is worth testing is that
 * every entry RESOLVES in both locales. A preset whose key is missing renders
 * the raw key path as a checkbox label, inside the one dialog whose whole job
 * is to make a mark answerable later.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { debugNotePresets } from '../debug-note-presets.js'

const ROOT = join(__dirname, '..', '..', '..', '..', '..')

function locale(name: string): Record<string, string> {
  const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'locales', `${name}.json`), 'utf8'))
  const v2 = (raw as { v2?: { tracks?: { debugPreset?: Record<string, string> } } }).v2
  return v2?.tracks?.debugPreset ?? {}
}

describe('debug note presets', () => {
  it('offers a stable, non-empty set of ids', () => {
    const ids = debugNotePresets((key) => key).map((p) => p.id)
    // The set the OPERATOR asked for on 2026-09-15, in their order. This was
    // previously derived from a reading of their real notes; the list is now
    // stated directly by the person who reviews with it, which is a better
    // source than eleven marks read on one afternoon.
    //
    // Pinned because the phrases are the matching key: ticking is derived from
    // the note containing the phrase, so a silent edit un-ticks every open note
    // that carries the old wording.
    expect(ids).toEqual([
      'stationaryObject',
      'lateStart',
      'earlyEnd',
      'targetSwapped',
      'edgeCropMirror',
      'betterShotExisted',
      'missingMedia',
      'cropOffTarget',
      'riderNotInKeyframe',
    ])
  })

  it('every preset has real copy in en and it', () => {
    for (const name of ['en', 'it']) {
      const strings = locale(name)
      for (const preset of debugNotePresets((key) => key)) {
        const text = strings[preset.id]
        expect(typeof text, `${name}: v2.tracks.debugPreset.${preset.id}`).toBe('string')
        expect((text ?? '').length, `${name}: ${preset.id} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('no phrase contains the separator that joins them', () => {
    // ' · ' splits a composed note back into segments. A phrase carrying one
    // would split into two, and unticking the box would then remove half of
    // itself and leave the other half in the operator's note forever.
    for (const name of ['en', 'it']) {
      for (const text of Object.values(locale(name))) expect(text).not.toContain(' · ')
    }
  })
})
