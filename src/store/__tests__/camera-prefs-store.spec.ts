import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  resetCameraPrefsEntry,
  setLocalNameEntry,
  setHiddenEntry,
  setOrderEntry,
  parseCameraPrefs,
  type AppCameraPrefs,
} from '../camera-prefs-store.js'

describe('camera-prefs-store DEFAULTS', () => {
  it('provides empty out-of-the-box defaults', () => {
    expect(DEFAULTS.byId).toEqual({})
    expect(DEFAULTS.order).toEqual([])
  })

  it('DEFAULTS is frozen (cannot be mutated)', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true)
    expect(Object.isFrozen(DEFAULTS.byId)).toBe(true)
    expect(Object.isFrozen(DEFAULTS.order)).toBe(true)
  })

  it('resetCameraPrefsEntry returns a fresh, mutable copy equal to DEFAULTS', () => {
    const fresh = resetCameraPrefsEntry()
    expect(fresh).toEqual(DEFAULTS)
    expect(fresh).not.toBe(DEFAULTS)
    expect(Object.isFrozen(fresh.byId)).toBe(false)
  })
})

describe('setLocalNameEntry', () => {
  const base: AppCameraPrefs = resetCameraPrefsEntry()

  it('sets a trimmed local name and does not mutate input', () => {
    const next = setLocalNameEntry(base, 7, '  Front Door  ')
    expect(next.byId[7]?.localName).toBe('Front Door')
    expect(next).not.toBe(base)
    expect(next.byId).not.toBe(base.byId)
    expect(base.byId[7]).toBeUndefined()
  })

  it('clears the name (drops the entry) when given empty / whitespace', () => {
    const withName = setLocalNameEntry(base, 7, 'Garage')
    const cleared = setLocalNameEntry(withName, 7, '   ')
    expect(cleared.byId[7]).toBeUndefined()
  })

  it('preserves a hidden flag when only renaming', () => {
    const hidden = setHiddenEntry(base, 3, true)
    const renamed = setLocalNameEntry(hidden, 3, 'Patio')
    expect(renamed.byId[3]).toEqual({ hidden: true, localName: 'Patio' })
  })
})

describe('setHiddenEntry', () => {
  const base: AppCameraPrefs = resetCameraPrefsEntry()

  it('sets hidden=true and does not mutate input', () => {
    const next = setHiddenEntry(base, 1, true)
    expect(next.byId[1]?.hidden).toBe(true)
    expect(next).not.toBe(base)
    expect(base.byId[1]).toBeUndefined()
  })

  it('clearing hidden drops the entry when no name remains', () => {
    const hidden = setHiddenEntry(base, 1, true)
    const shown = setHiddenEntry(hidden, 1, false)
    expect(shown.byId[1]).toBeUndefined()
  })

  it('clearing hidden keeps a local name', () => {
    const named = setLocalNameEntry(base, 1, 'Hall')
    const hidden = setHiddenEntry(named, 1, true)
    const shown = setHiddenEntry(hidden, 1, false)
    expect(shown.byId[1]).toEqual({ localName: 'Hall' })
  })
})

describe('setOrderEntry', () => {
  const base: AppCameraPrefs = resetCameraPrefsEntry()

  it('sets the order and does not mutate input', () => {
    const next = setOrderEntry(base, [3, 1, 2])
    expect(next.order).toEqual([3, 1, 2])
    expect(next).not.toBe(base)
    expect(base.order).toEqual([])
  })

  it('de-dupes and drops non-integers', () => {
    const next = setOrderEntry(base, [3, 3, 1, 2, 1])
    expect(next.order).toEqual([3, 1, 2])
  })
})

describe('parseCameraPrefs', () => {
  it('returns defaults for null / invalid JSON', () => {
    expect(parseCameraPrefs(null)).toEqual(DEFAULTS)
    expect(parseCameraPrefs('not json')).toEqual(DEFAULTS)
    expect(parseCameraPrefs('"a string"')).toEqual(DEFAULTS)
    expect(parseCameraPrefs('null')).toEqual(DEFAULTS)
  })

  it('round-trips a full document', () => {
    const custom = setOrderEntry(
      setHiddenEntry(setLocalNameEntry(resetCameraPrefsEntry(), 7, 'Front Door'), 9, true),
      [9, 7, 4],
    )
    const parsed = parseCameraPrefs(JSON.stringify(custom))
    expect(parsed).toEqual(custom)
  })

  it('drops the device-local fields an older document carried (they live in camera-local now)', () => {
    const parsed = parseCameraPrefs(
      JSON.stringify({
        byId: {
          '1': { localName: 'Gate', quality: 'high', audioOn: true, timelineKinds: ['audio'], timelineClasses: ['dog'] },
          '2': { quality: 'low', audioOn: false },
        },
      }),
    )
    expect(parsed.byId[1]).toEqual({ localName: 'Gate' })
    expect(parsed.byId[2]).toBeUndefined()
  })

  it('drops malformed per-camera entries and sanitises order', () => {
    const parsed = parseCameraPrefs(
      JSON.stringify({
        byId: {
          '5': { localName: 'Yard' },
          '6': { hidden: false },
          '7': { foo: 'bar' },
          notANumber: { localName: 'X' },
        },
        order: [5, 5, 'x', 7, 2.5, 6],
      }),
    )
    expect(parsed.byId[5]).toEqual({ localName: 'Yard' })
    expect(parsed.byId[6]).toBeUndefined()
    expect(parsed.byId[7]).toBeUndefined()
    expect(parsed.order).toEqual([5, 7, 6])
  })
})
