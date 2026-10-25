import { describe, it, expect } from 'vitest'
import { parseGridConfig, readGridConfig } from '../embed-grid-config'

describe('parseGridConfig', () => {
  const base = {
    serverUrl: 'https://hub.local',
    token: 'jwt',
    devices: [7, 8, 9],
    layout: 'auto',
    quality: 'auto',
    showName: true,
    showBadges: true,
    muted: true,
    paused: false,
  }

  it('accepts a valid config', () => {
    const r = parseGridConfig(base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.devices).toEqual([7, 8, 9])
  })

  it('carries where a tile draws its stream read-out, and tolerates a host that does not say', () => {
    const placed = parseGridConfig({ ...base, overlays: { '7': { stats: true, statsAt: 'bottom-left' } } })
    expect(placed.ok).toBe(true)
    if (placed.ok) expect(placed.config.overlays?.['7']).toEqual({ stats: true, statsAt: 'bottom-left' })
    const legacy = parseGridConfig({ ...base, overlays: { '7': { stats: true } } })
    expect(legacy.ok).toBe(true)
    if (legacy.ok) expect(legacy.config.overlays?.['7']?.statsAt).toBeUndefined()
  })

  it('carries the live-viewers position and the device overlay size, and tolerates a host that sends neither', () => {
    const placed = parseGridConfig({
      ...base,
      overlays: { '7': { viewers: 'top-left', size: 'large' } },
    })
    expect(placed.ok).toBe(true)
    if (placed.ok) expect(placed.config.overlays?.['7']).toEqual({ viewers: 'top-left', size: 'large' })
    const legacy = parseGridConfig({ ...base, overlays: { '7': { audioMeter: 'top-center' } } })
    expect(legacy.ok).toBe(true)
    if (legacy.ok) {
      expect(legacy.config.overlays?.['7']?.viewers).toBeUndefined()
      expect(legacy.config.overlays?.['7']?.size).toBeUndefined()
    }
  })

  it('rejects an unknown overlay size rather than drawing at a guessed one', () => {
    expect(parseGridConfig({ ...base, overlays: { '7': { size: 'huge' } } }).ok).toBe(false)
  })

  it('accepts a fixed numeric layout', () => {
    const r = parseGridConfig({ ...base, layout: 3 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.layout).toBe(3)
  })

  it('rejects empty devices', () => {
    const r = parseGridConfig({ ...base, devices: [] })
    expect(r.ok).toBe(false)
  })

  it('rejects a missing token', () => {
    const r = parseGridConfig({ ...base, token: '' })
    expect(r.ok).toBe(false)
  })

  it('an unknown quality NORMALISES — it does not take the whole wall down', () => {
    // Changed on 2026-09-02 with the scale. A host older than this bundle sends
    // `medium`, the spelling the viewer retired in favour of the system's
    // `mid`, and refusing the config over one preference would leave a blank
    // page where a working wall should be. The operator's rule for a persisted
    // value that is no longer a value is normalise-to-default, never convert
    // and never reject.
    for (const stale of ['ultra', 'medium']) {
      const r = parseGridConfig({ ...base, quality: stale })
      expect(r.ok, stale).toBe(true)
      if (r.ok) expect(r.config.quality, stale).toBe('auto')
    }
  })

  it('a tier this bundle knows still arrives intact', () => {
    const r = parseGridConfig({ ...base, quality: 'mid' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.quality).toBe('mid')
  })

  it('accepts the optional showBoxes flag (absent ⇒ undefined)', () => {
    const withBoxes = parseGridConfig({ ...base, showBoxes: true })
    expect(withBoxes.ok).toBe(true)
    if (withBoxes.ok) expect(withBoxes.config.showBoxes).toBe(true)

    const without = parseGridConfig(base)
    expect(without.ok).toBe(true)
    if (without.ok) expect(without.config.showBoxes).toBeUndefined()
  })

  it('accepts highlight.motionHoldSec (viewer linger) and tolerates its absence (legacy grids)', () => {
    const highlightBase = {
      enabled: true,
      motion: true,
      audio: 'off',
      audioDb: -30,
      audioHoldSec: 3,
      detection: false,
      detectionHoldSec: 3,
    }
    const withHold = parseGridConfig({
      ...base,
      highlight: { ...highlightBase, motionHoldSec: 5 },
    })
    expect(withHold.ok).toBe(true)
    if (withHold.ok) expect(withHold.config.highlight?.motionHoldSec).toBe(5)

    const legacy = parseGridConfig({ ...base, highlight: highlightBase })
    expect(legacy.ok).toBe(true)
    if (legacy.ok) expect(legacy.config.highlight?.motionHoldSec).toBeUndefined()
  })
})

describe('readGridConfig', () => {
  const base = {
    serverUrl: 'https://hub.local',
    token: 'jwt',
    devices: [7, 8, 9],
    layout: 'auto',
    quality: 'auto',
    showName: true,
    showBadges: true,
    muted: true,
    paused: false,
  }

  it('returns ok:true when window.__CAMSTACK_GRID__ is a valid config', () => {
    ;(window as unknown as { __CAMSTACK_GRID__?: unknown }).__CAMSTACK_GRID__ = base
    const r = readGridConfig()
    expect(r.ok).toBe(true)
    delete (window as unknown as { __CAMSTACK_GRID__?: unknown }).__CAMSTACK_GRID__
  })

  it('returns ok:false with window.__CAMSTACK_GRID__ in the error when global is unset', () => {
    delete (window as unknown as { __CAMSTACK_GRID__?: unknown }).__CAMSTACK_GRID__
    const r = readGridConfig()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('window.__CAMSTACK_GRID__')
  })
})
