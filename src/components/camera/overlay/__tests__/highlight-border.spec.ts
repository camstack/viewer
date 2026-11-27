import { describe, it, expect } from 'vitest'
import { GRID_HIGHLIGHT_DEFAULTS } from '../../../../store/grid-store.js'
import { highlightBorderEnabled } from '../highlight-border.js'

describe('the border is derived from its triggers (planning#749)', () => {
  const off = { ...GRID_HIGHLIGHT_DEFAULTS, motion: false, audio: 'off' as const, detection: false }
  it('is off when every trigger is off', () => {
    expect(highlightBorderEnabled(off)).toBe(false)
  })
  it.each([
    ['motion', { motion: true }],
    ['audio', { audio: 'level' as const }],
    ['detection', { detection: true }],
  ])('is on as soon as %s is on', (_name, patch) => {
    expect(highlightBorderEnabled({ ...off, ...patch })).toBe(true)
  })
})
