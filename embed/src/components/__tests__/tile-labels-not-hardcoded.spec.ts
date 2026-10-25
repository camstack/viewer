/**
 * No control on the wall carries its own words.
 *
 * The injected-labels design has one failure mode that no behavioural test
 * catches: a NEW control added later with `label="Snapshot"` written inline. It
 * looks right, it reads right in review, and it is a permanently English button
 * in an Italian app — the exact drift the design was chosen to avoid. The only
 * thing that notices is a source guard, so this is one.
 *
 * It is deliberately narrow. It does not ask that a string never appears in the
 * file (icons, styles and comments legitimately contain words); it asks that
 * the two props that BECOME an accessible name — `label` on `OverlayButton` and
 * on `SpanGrip` — are never given a literal.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_TILE_LABELS } from '../../embed/tile-labels'

const TILE = readFileSync(join(__dirname, '..', 'GridTilePlayer.tsx'), 'utf8')

describe('the tile draws no word of its own', () => {
  it('every `label=` is an expression, never a string literal', () => {
    const literals = [...TILE.matchAll(/\blabel="([^"]*)"/g)].map((m) => m[1])
    expect(literals).toEqual([])
  })

  it('and the English lives only in the fallback module', () => {
    // The defaults ARE the compatibility contract; a copy of one of them inside
    // the component means a control that stopped reading the injected map.
    for (const word of [
      DEFAULT_TILE_LABELS.open,
      DEFAULT_TILE_LABELS.moreActions,
      DEFAULT_TILE_LABELS.removeFromView,
      DEFAULT_TILE_LABELS.resizeWidth,
      DEFAULT_TILE_LABELS.resizeHeight,
      DEFAULT_TILE_LABELS.linkedDevices,
    ]) {
      expect(TILE.includes(`"${word}"`), `"${word}" is hardcoded in GridTilePlayer`).toBe(false)
      expect(TILE.includes(`'${word}'`), `'${word}' is hardcoded in GridTilePlayer`).toBe(false)
    }
  })
})
