/**
 * The tile's secondary panels belong to the HOST, and a host that has none
 * must be able to say so.
 *
 * The page passed `onCellPanel` unconditionally, so the gate the tile already
 * had (`{onCellPanel ? … : null}`) never fired: in the Home Assistant card
 * the linked-devices and view-options discs were drawn on every tile and did
 * nothing when tapped. `cellPanels: false` withholds the callback.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { gridConfigSchema } from '../embed-grid-config.js'

const SRC = join(process.cwd(), 'embed', 'src')
const PAGE = readFileSync(join(SRC, 'pages', 'EmbedGridPage.tsx'), 'utf8')
const TILE = readFileSync(join(SRC, 'components', 'GridTilePlayer.tsx'), 'utf8')

const base = {
  serverUrl: 'https://hub:4443',
  token: 't',
  devices: [1],
  layout: 'auto',
  quality: 'auto',
  showName: true,
  showBadges: true,
  muted: true,
  paused: false,
} as const

describe('cellPanels', () => {
  it('is absent by default — the app keeps its panels', () => {
    const parsed = gridConfigSchema.parse({ ...base })
    expect(parsed.cellPanels).toBeUndefined()
  })

  it('is carried when a host declares it has nowhere to show them', () => {
    expect(gridConfigSchema.parse({ ...base, cellPanels: false }).cellPanels).toBe(false)
    expect(gridConfigSchema.parse({ ...base, cellPanels: true }).cellPanels).toBe(true)
  })

  it('the page withholds the callback on false, and only on false', () => {
    expect(PAGE).toContain('config.cellPanels === false')
    expect(PAGE).toMatch(/config\.cellPanels === false\s*\?\s*undefined/)
  })

  it('the tile draws the discs only when the callback exists — the gate this feeds', () => {
    expect(TILE).toContain('{onCellPanel')
    // PTZ must NOT collapse behind a list a panel-less host can never open.
    expect(TILE).toContain('!onCellPanel || !secondary.overflow')
  })
})
