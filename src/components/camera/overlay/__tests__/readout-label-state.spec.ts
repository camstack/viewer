/**
 * planning#751 — a pinned readout may hide its sensor name, and a string value
 * that is a state word is shown in the viewer's language.
 */
import { describe, expect, it } from 'vitest'
import { formatLiveValue } from '../../../../data/use-device-live-fields.js'
import { translateStateWord } from '../../../../lib/state-label.js'
import { OVERLAY_DEFAULTS, parseOverlayConfig, patchReadout } from '../overlay-config.js'

const readout = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: 'r1',
  source: { kind: 'cameraField', sectionId: 's', fieldKey: 'k' },
  label: 'Door',
  corner: 'top-right',
  ...extra,
})

describe('OverlayReadout.showLabel', () => {
  it('is absent (the name shows) unless the operator turned it off', () => {
    const on = parseOverlayConfig({ readouts: [readout({})] }).readouts[0]
    expect(on?.showLabel).toBeUndefined()
    const off = parseOverlayConfig({ readouts: [readout({ showLabel: false })] }).readouts[0]
    expect(off?.showLabel).toBe(false)
  })

  it('patches and round-trips through storage', () => {
    const base = parseOverlayConfig({ readouts: [readout({})] })
    const patched = patchReadout(base, 'r1', { showLabel: false })
    const again = parseOverlayConfig(JSON.parse(JSON.stringify(patched)))
    expect(again.readouts[0]?.showLabel).toBe(false)
    expect(OVERLAY_DEFAULTS.readouts).toEqual([])
  })
})

describe('string values go through the state dictionary', () => {
  const labels = { onLabel: 'On', offLabel: 'Off' }

  it('translates a known state word', () => {
    expect(translateStateWord('open', 'it')).toBe('Aperto')
    expect(translateStateWord('open', 'en')).toBe('Open')
    expect(translateStateWord('locked', 'it-IT')).toBe('Bloccata')
  })

  it('leaves free text untouched', () => {
    expect(translateStateWord('Living room 2', 'it')).toBe('Living room 2')
  })

  it('formatLiveValue applies stateText to strings only', () => {
    const stateText = (w: string): string => translateStateWord(w, 'it')
    expect(formatLiveValue('closed', { ...labels, stateText })).toBe('Chiuso')
    expect(formatLiveValue('closed', labels)).toBe('closed')
    expect(formatLiveValue(21.456, { ...labels, precision: 1, unit: '°C', stateText })).toBe('21.5 °C')
  })
})
