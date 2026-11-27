import { describe, it, expect } from 'vitest'
import { GRID_HIGHLIGHT_DEFAULTS } from '../../../../store/grid-store.js'
import {
  ALL_TRIGGERS_OFF,
  highlightBorderEnabled,
  resolveTriggers,
  settleMasterOff,
} from '../highlight-border.js'
import { OVERLAY_DEFAULTS, parseOverlayConfig } from '../overlay-config.js'

describe('the border is derived from its triggers (planning#749)', () => {
  const off = { ...GRID_HIGHLIGHT_DEFAULTS, ...ALL_TRIGGERS_OFF }
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

describe('migrating a master-off document', () => {
  it('master off: the triggers go off and cameras with none start all-off', () => {
    const doc = parseOverlayConfig({ highlightBorder: false })
    const settled = settleMasterOff(doc)
    expect(settled).not.toBeNull()
    expect(settled?.triggerPatch).toEqual(ALL_TRIGGERS_OFF)
    expect(settled?.overlay.legacyMasterOff).toBe(false)
    expect(settled?.overlay.highlightDefaultOff).toBe(true)
    // After settling, a camera with no stored triggers resolves all-off ...
    const fresh = resolveTriggers(undefined, settled?.overlay ?? OVERLAY_DEFAULTS)
    expect(highlightBorderEnabled(fresh)).toBe(false)
    // ... and the migration does not run twice.
    expect(settleMasterOff(settled?.overlay ?? OVERLAY_DEFAULTS)).toBeNull()
  })
  it('master on keeps its triggers: nothing to settle, defaults untouched', () => {
    const doc = parseOverlayConfig({ highlightBorder: true })
    expect(settleMasterOff(doc)).toBeNull()
    expect(resolveTriggers(undefined, doc)).toEqual(GRID_HIGHLIGHT_DEFAULTS)
    expect(resolveTriggers({ detection: true }, doc).detection).toBe(true)
  })
  it('a stored camera keeps what it stored, even in a migrated document', () => {
    const migrated = { ...OVERLAY_DEFAULTS, highlightDefaultOff: true }
    expect(resolveTriggers({ motion: true }, migrated).motion).toBe(true)
  })
})
