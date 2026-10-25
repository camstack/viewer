import { describe, it, expect } from 'vitest'
import { DeviceType } from '@camstack/types/client'
import {
  pickAccessoryControl, hasMotionTrigger, isActuatingControlKind, MOTION_TRIGGER_FEATURE,
  type AccessoryControlKind,
} from '../control-registry.js'

/** Helper: pick by device type + optional secondary features. */
const pick = (type: string, features: readonly string[] = []) =>
  pickAccessoryControl({ type, features })

describe('pickAccessoryControl (by DeviceType)', () => {
  it('returns "none" for structural / non-interactive types', () => {
    expect(pick('camera')).toEqual({ kind: 'none' })
    expect(pick('generic', ['battery-operated'])).toEqual({ kind: 'none' })
    expect(pick('hub')).toEqual({ kind: 'none' })
    expect(pick('container')).toEqual({ kind: 'none' })
    expect(pick('notifier')).toEqual({ kind: 'none' })
    expect(pick('script')).toEqual({ kind: 'none' })
    expect(pick('automation')).toEqual({ kind: 'none' })
  })

  it('picks switch for a switch or siren', () => {
    expect(pick('switch')).toEqual({ kind: 'switch' })
    expect(pick('siren')).toEqual({ kind: 'switch' })
  })

  it('picks switch for a plain light, brightness for a dimmable one', () => {
    expect(pick('light')).toEqual({ kind: 'switch' })
    expect(pick('light', ['brightness'])).toEqual({ kind: 'brightness' })
  })

  it('picks lock for a lock', () => {
    expect(pick('lock')).toEqual({ kind: 'lock' })
  })

  it('picks cover for a cover and valve for a valve', () => {
    expect(pick('cover')).toEqual({ kind: 'cover' })
    expect(pick('valve')).toEqual({ kind: 'valve' })
  })

  it('picks alarm for an alarm-panel', () => {
    expect(pick('alarm-panel')).toEqual({ kind: 'alarm' })
  })

  it('picks climate for a thermostat or air-conditioner', () => {
    expect(pick('thermostat')).toEqual({ kind: 'climate' })
    expect(pick('climate')).toEqual({ kind: 'climate' })
  })

  it('picks fan for a fan', () => {
    expect(pick('fan')).toEqual({ kind: 'fan' })
  })

  it('picks button for a fire-only button/input_button', () => {
    expect(pick('button')).toEqual({ kind: 'button' })
  })

  it('picks the read-only event-emitter row for a wall switch / remote', () => {
    // Pure INPUT: nothing to actuate, but the cap carries which button fired,
    // which event type, and when — so the row is a readout, not `none`.
    expect(pick('event-emitter')).toEqual({ kind: 'event-emitter' })
  })

  it('picks the full-parity controls ported from admin-ui', () => {
    expect(pick('media-player')).toEqual({ kind: 'media-player' })
    expect(pick('vacuum')).toEqual({ kind: 'vacuum' })
    expect(pick('lawn-mower')).toEqual({ kind: 'lawn-mower' })
    expect(pick('pet-feeder')).toEqual({ kind: 'pet-feeder' })
    expect(pick('humidifier')).toEqual({ kind: 'humidifier' })
    expect(pick('water-heater')).toEqual({ kind: 'water-heater' })
    expect(pick('update')).toEqual({ kind: 'update' })
    expect(pick('weather')).toEqual({ kind: 'weather' })
    expect(pick('image')).toEqual({ kind: 'image' })
    expect(pick('control')).toEqual({ kind: 'input' })
  })

  it('reads a sensor value for a sensor/presence device with a sensor cap', () => {
    expect(pick('sensor', ['temperature-sensor'])).toEqual({
      kind: 'sensor',
      sensorFeature: 'temperature-sensor',
    })
    expect(pick('presence', ['enum-sensor'])).toEqual({
      kind: 'sensor',
      sensorFeature: 'enum-sensor',
    })
  })

  it('returns the first matching sensor feature in canonical order', () => {
    expect(pick('sensor', ['humidity-sensor', 'temperature-sensor'])).toEqual({
      kind: 'sensor',
      sensorFeature: 'temperature-sensor',
    })
  })

  it('returns "none" for a sensor device with no recognised sensor cap', () => {
    expect(pick('sensor', [])).toEqual({ kind: 'none' })
  })
})

/**
 * Parity contract: every shared DeviceType resolves to a control kind (never
 * throws / undefined), and every CONTROLLABLE type resolves to a real control
 * (not 'none'). This documents the intent enforced at compile time by the
 * `satisfies Record<DeviceType, …>` guard in control-registry.ts — the map
 * lists every DeviceType, so a new enum member without a mapping fails tsc.
 */
describe('DeviceType parity', () => {
  /** Non-interactive / structural types intentionally map to 'none'. */
  const STRUCTURAL: readonly string[] = [
    'camera', 'hub', 'generic', 'container', 'notifier', 'script',
    'automation',
  ]
  // Controllable, but the viewer has no row for it yet (its page is the hub's).
  const NO_VIEWER_CONTROL_YET: readonly string[] = ['dishwasher']

  it('resolves a control kind for every shared DeviceType', () => {
    for (const type of Object.values(DeviceType)) {
      const kind: AccessoryControlKind = pickAccessoryControl({ type, features: [] }).kind
      expect(typeof kind).toBe('string')
    }
  })

  it('maps every controllable DeviceType to a real control (no "none")', () => {
    for (const type of Object.values(DeviceType)) {
      if (STRUCTURAL.includes(type) || NO_VIEWER_CONTROL_YET.includes(type)) continue
      // Sensor/presence need a sensor feature to resolve a value; supply one so
      // the controllable assertion holds for the value-bearing case.
      const features = type === 'sensor' || type === 'presence' ? ['temperature-sensor'] : []
      expect(pickAccessoryControl({ type, features }).kind).not.toBe('none')
    }
  })

  it('covers server types not yet in the pinned enum (forward-compat bridge)', () => {
    expect(pick('climate')).toEqual({ kind: 'climate' })
    expect(pick('pet-feeder')).toEqual({ kind: 'pet-feeder' })
  })
})

describe('hasMotionTrigger', () => {
  it('uses the "motion-trigger" cap kebab name', () => {
    expect(MOTION_TRIGGER_FEATURE).toBe('motion-trigger')
  })

  it('is true only when the motion-trigger cap is advertised', () => {
    expect(hasMotionTrigger(['motion-trigger'])).toBe(true)
    expect(hasMotionTrigger(['switch', 'motion-trigger'])).toBe(true)
    expect(hasMotionTrigger(['switch', 'brightness'])).toBe(false)
    expect(hasMotionTrigger([])).toBe(false)
  })

  it('does not match the bare motion sensor cap or other motion-prefixed caps', () => {
    expect(hasMotionTrigger(['motion'])).toBe(false)
    expect(hasMotionTrigger(['motion-detection'])).toBe(false)
    expect(hasMotionTrigger(['motion-zones'])).toBe(false)
  })
})

/**
 * Which rows a session that may VIEW a camera but not act on it keeps.
 *
 * The split is not eyeballable per call site — `update` and `input` sound
 * actuating and are read-only, `button` sounds inert and fires a relay — which
 * is exactly why it lives in one exhaustive map instead of a condition at each
 * renderer.
 */
describe('isActuatingControlKind', () => {
  it('calls every commanding control an actuator', () => {
    const actuators: readonly AccessoryControlKind[] = [
      'cover', 'lock', 'alarm', 'valve', 'climate', 'fan', 'brightness',
      'switch', 'button', 'media-player', 'vacuum', 'lawn-mower',
      'pet-feeder', 'humidifier', 'water-heater',
    ]
    for (const kind of actuators) expect(isActuatingControlKind(kind)).toBe(true)
  })

  it('keeps the read-only rows — a viewer still sees state', () => {
    const readOnly: readonly AccessoryControlKind[] = [
      'sensor', 'update', 'weather', 'image', 'input', 'event-emitter', 'none',
    ]
    for (const kind of readOnly) expect(isActuatingControlKind(kind)).toBe(false)
  })

  it('answers for EVERY kind the registry can pick — no kind falls through', () => {
    const everyKind: readonly AccessoryControlKind[] = [
      'cover', 'lock', 'alarm', 'valve', 'climate', 'fan', 'brightness', 'switch',
      'button', 'sensor', 'media-player', 'vacuum', 'lawn-mower', 'pet-feeder',
      'humidifier', 'water-heater', 'update', 'weather', 'image', 'input',
      'event-emitter', 'none',
    ]
    for (const kind of everyKind) expect(typeof isActuatingControlKind(kind)).toBe('boolean')
  })

  it('treats a siren as an actuator (it picks `switch`, not a siren kind)', () => {
    expect(isActuatingControlKind(pick('siren').kind)).toBe(true)
  })

  it('treats an alarm panel as an actuator — arm/disarm is the whole row', () => {
    expect(isActuatingControlKind(pick('alarm-panel').kind)).toBe(true)
  })

  it('leaves a temperature sensor alone', () => {
    expect(isActuatingControlKind(pick('sensor', ['temperature-sensor']).kind)).toBe(false)
  })
})
