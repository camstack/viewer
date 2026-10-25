import { describe, it, expect } from 'vitest'
import {
  buildModeOptions, clampTarget, formatSetpoint, formatTemp, setpointModel,
  setpointWrite, stepSetpoint,
  CLIMATE_MIN_C, CLIMATE_MAX_C, type ClimateStatus, type HvacMode,
} from '../climate-logic.js'

const base: ClimateStatus = {
  mode: 'heat',
  availableModes: ['off', 'heat', 'cool', 'auto'],
  target: 21,
  targetLow: null,
  targetHigh: null,
  currentTemp: 19,
}

describe('clampTarget', () => {
  it('clamps below MIN and above MAX', () => {
    expect(clampTarget(-5)).toBe(CLIMATE_MIN_C)
    expect(clampTarget(100)).toBe(CLIMATE_MAX_C)
  })
  it('snaps to the 0.5 step grid and avoids float dust', () => {
    expect(clampTarget(21.3)).toBe(21.5)
    expect(clampTarget(21.2)).toBe(21)
    expect(clampTarget(20.1 + 0.2)).toBe(20.5)
  })
})

describe('setpointModel', () => {
  it('single-target mode uses target', () => {
    expect(setpointModel(base)).toEqual({ kind: 'single', value: 21 })
  })
  it('heat_cool uses the dual range', () => {
    expect(
      setpointModel({ ...base, mode: 'heat_cool', target: null, targetLow: 18, targetHigh: 24 }),
    ).toEqual({ kind: 'range', low: 18, high: 24 })
  })
  it('yields none when there is no setpoint (off / fan_only)', () => {
    expect(setpointModel({ ...base, mode: 'off', target: null })).toEqual({ kind: 'none' })
    expect(setpointModel({ ...base, mode: 'fan_only', target: null })).toEqual({ kind: 'none' })
  })
})

describe('stepSetpoint', () => {
  it('moves a single target by half a degree per step', () => {
    expect(stepSetpoint({ kind: 'single', value: 21 }, 1)).toEqual({ kind: 'single', value: 21.5 })
    expect(stepSetpoint({ kind: 'single', value: 21 }, -1)).toEqual({ kind: 'single', value: 20.5 })
  })
  it('folds a burst of taps into one multi-step move', () => {
    expect(stepSetpoint({ kind: 'single', value: 19 }, 8)).toEqual({ kind: 'single', value: 23 })
  })
  it('clamps at the bounds instead of running away', () => {
    expect(stepSetpoint({ kind: 'single', value: 34.5 }, 20)).toEqual({ kind: 'single', value: CLIMATE_MAX_C })
    expect(stepSetpoint({ kind: 'single', value: 5.5 }, -20)).toEqual({ kind: 'single', value: CLIMATE_MIN_C })
  })
  it('shifts both ends of a range, preserving the band', () => {
    expect(stepSetpoint({ kind: 'range', low: 18, high: 24 }, 2)).toEqual({
      kind: 'range', low: 19, high: 25,
    })
  })
  it('is a no-op for zero steps and for a non-editable model', () => {
    const single = { kind: 'single', value: 21 } as const
    expect(stepSetpoint(single, 0)).toBe(single)
    expect(stepSetpoint({ kind: 'none' }, 3)).toEqual({ kind: 'none' })
  })
})

describe('setpointWrite', () => {
  it('maps a single target onto setTarget', () => {
    expect(setpointWrite({ kind: 'single', value: 21.5 })).toEqual({
      method: 'setTarget', args: { target: 21.5 },
    })
  })
  it('maps a range onto setTargetRange', () => {
    expect(setpointWrite({ kind: 'range', low: 18, high: 24 })).toEqual({
      method: 'setTargetRange', args: { targetLow: 18, targetHigh: 24 },
    })
  })
  it('writes nothing when the mode has no setpoint', () => {
    expect(setpointWrite({ kind: 'none' })).toBeNull()
  })
})

describe('buildModeOptions', () => {
  const label = (mode: HvacMode): string => `L:${mode}`
  it('keeps the device order and labels every mode', () => {
    expect(buildModeOptions(['off', 'heat', 'cool'], 'heat', label)).toEqual([
      { value: 'off', label: 'L:off' },
      { value: 'heat', label: 'L:heat' },
      { value: 'cool', label: 'L:cool' },
    ])
  })
  it('includes the active mode the device forgot to advertise', () => {
    const options = buildModeOptions(['off', 'heat'], 'dry', label)
    expect(options.map((option) => option.value)).toEqual(['dry', 'off', 'heat'])
  })
  it('de-duplicates repeated modes', () => {
    const options = buildModeOptions(['off', 'heat', 'off'], 'off', label)
    expect(options.map((option) => option.value)).toEqual(['off', 'heat'])
  })
  it('still offers the active mode when the device advertises none', () => {
    expect(buildModeOptions([], 'cool', label)).toEqual([{ value: 'cool', label: 'L:cool' }])
  })
})

describe('formatting', () => {
  it('trims a trailing .0 and keeps the half degree', () => {
    expect(formatTemp(21)).toBe('21°')
    expect(formatTemp(21.5)).toBe('21.5°')
  })
  it('renders a range with an en dash and a placeholder for none', () => {
    expect(formatSetpoint({ kind: 'single', value: 21.5 })).toBe('21.5°')
    expect(formatSetpoint({ kind: 'range', low: 18, high: 24 })).toBe('18°–24°')
    expect(formatSetpoint({ kind: 'none' })).toBe('--')
  })
})
