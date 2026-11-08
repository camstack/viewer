import { describe, expect, it } from 'vitest'
import { resolveDeviceSlots, DEVICE_SLOT_ORDER } from '../device-slots.js'

const ids = (type: string, caps: string[]) => resolveDeviceSlots({ type, caps }).map((s) => s.slot)
const widgets = (type: string, caps: string[], slot: string) =>
  resolveDeviceSlots({ type, caps }).find((s) => s.slot === slot)?.entries.map((e) => e.widget)

describe('device slots', () => {
  it('a heater: header power, running line, its switch, and the timer', () => {
    const caps = ['switch', 'running-state', 'power-meter', 'timed-run']
    expect(ids('heater', caps)).toEqual(['header', 'status', 'primary', 'timer'])
    expect(widgets('heater', caps, 'header')).toEqual(['power-draw'])
    expect(widgets('heater', caps, 'primary')).toEqual(['primary-control'])
  })

  it('a washer: running line and consumables, no control, no timer', () => {
    const caps = ['running-state', 'consumables', 'power-meter']
    expect(ids('washer', caps)).toEqual(['header', 'status', 'consumables'])
  })

  it('a contact sensor: battery in the header, the open/closed line as status', () => {
    const caps = ['contact', 'battery']
    expect(ids('sensor', caps)).toEqual(['header', 'status'])
    expect(widgets('sensor', caps, 'header')).toEqual(['battery'])
    expect(widgets('sensor', caps, 'status')).toEqual(['contact-state'])
  })

  it('an unknown device shows the header alone', () => {
    expect(ids('mystery', [])).toEqual(['header'])
    expect(ids('mystery', ['some-future-cap'])).toEqual(['header'])
  })

  it('without a control the main reading is primary and the others are readings', () => {
    const caps = ['temperature-sensor', 'humidity-sensor']
    expect(widgets('generic', caps, 'primary')).toEqual(['main-reading'])
    expect(widgets('generic', caps, 'readings')).toEqual(['reading'])
  })

  it('a thermostat uses the registry control, not a switch fallback', () => {
    const slots = resolveDeviceSlots({ type: 'thermostat', caps: ['climate', 'switch'] })
    expect(slots.find((s) => s.slot === 'primary')?.entries[0].pick?.kind).toBe('climate')
  })

  it('slots always come in the fixed order', () => {
    const caps = ['timed-run', 'consumables', 'motion-trigger', 'running-state', 'battery', 'switch']
    const order = ids('switch', caps)
    expect(order).toEqual(DEVICE_SLOT_ORDER.filter((s) => order.includes(s)))
    expect(order).toEqual(['header', 'status', 'primary', 'secondary', 'consumables', 'timer'])
  })
})
