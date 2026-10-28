import { describe, expect, it } from 'vitest'
import { toBrightnessStatus, toFanStatus } from '../use-accessory-controls'

const FAN_REST = {
  preset: 'auto',
  availablePresets: ['auto'],
  direction: null,
  oscillating: null,
}

describe('accessory status under the renamed hub fields', () => {
  it('brightness: `level`, or `percentage` from a hub that has not been migrated', () => {
    expect(toBrightnessStatus({ level: 40 })).toEqual({ level: 40 })
    expect(toBrightnessStatus({ percentage: 55 })).toEqual({ level: 55 })
    expect(toBrightnessStatus({ level: 40, percentage: 99 })).toEqual({ level: 40 })
    expect(toBrightnessStatus({})).toBeNull()
  })

  it('fan: `speed`, `percentage`, and a null speed stays null', () => {
    expect(toFanStatus({ speed: 60, ...FAN_REST })?.speed).toBe(60)
    expect(toFanStatus({ percentage: 25, ...FAN_REST })?.speed).toBe(25)
    expect(toFanStatus({ speed: null, percentage: 25, ...FAN_REST })?.speed).toBeNull()
    expect(toFanStatus({ ...FAN_REST })).toBeNull()
  })
})
