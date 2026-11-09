/**
 * Which devices keep their legacy inline control on a hero row. Every kind with
 * an interactive control does; read-only kinds draw the hub's model; and any
 * device with motion-trigger or timed-run keeps the control that carries them.
 */
import { describe, expect, it } from 'vitest'
import { heroRowKeepsShortcuts } from '../control-registry.js'
import { MOTION_TRIGGER_FEATURE } from '../control-registry.js'

const keeps = (type: string, features: readonly string[] = []): boolean =>
  heroRowKeepsShortcuts({ type, features })

describe('heroRowKeepsShortcuts, per device kind', () => {
  it.each([
    ['cover', []], ['valve', []], ['light', ['brightness']], ['light', []], ['switch', []], ['siren', []],
    ['fan', []], ['lock', []], ['alarm-panel', []], ['climate', []], ['media-player', []],
    ['vacuum', []], ['lawn-mower', []], ['pet-feeder', []], ['humidifier', []], ['water-heater', []],
    ['button', []],
  ])('%s keeps its legacy inline control', (type, features) => {
    expect(keeps(type, features)).toBe(true)
  })

  it.each([['camera'], ['hub'], ['container']])('%s (no control) draws the hub model', (type) => {
    expect(keeps(type)).toBe(false)
  })

  it('a read-only sensor draws the hub model', () => {
    expect(keeps('sensor', ['temperature-sensor'])).toBe(false)
  })
})

describe('extra features keep the row control for every kind', () => {
  it.each(['switch', 'siren', 'camera', 'sensor', 'hub'])('%s with timed-run', (type) => {
    expect(keeps(type, ['timed-run'])).toBe(true)
  })
  it.each(['switch', 'camera', 'sensor'])('%s with motion-trigger', (type) => {
    expect(keeps(type, [MOTION_TRIGGER_FEATURE])).toBe(true)
  })
})
