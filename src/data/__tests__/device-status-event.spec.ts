import { describe, it, expect } from 'vitest'
import {
  DEVICE_STATUS_CAP,
  isDeviceStatusChange,
  readEventField,
} from '../device-status-event.js'

describe('readEventField', () => {
  it('reads a top-level field', () => {
    expect(readEventField({ capName: 'battery' }, 'capName')).toBe('battery')
  })

  it('reads a field nested under `data` (the hub bus envelope)', () => {
    expect(readEventField({ data: { capName: 'battery' } }, 'capName')).toBe('battery')
  })

  it('prefers the top-level field when both are present', () => {
    expect(readEventField({ capName: 'a', data: { capName: 'b' } }, 'capName')).toBe('a')
  })

  it('returns undefined for non-objects and missing fields', () => {
    expect(readEventField(null, 'capName')).toBeUndefined()
    expect(readEventField('device-status', 'capName')).toBeUndefined()
    expect(readEventField({ data: 7 }, 'capName')).toBeUndefined()
    expect(readEventField({}, 'capName')).toBeUndefined()
  })
})

describe('isDeviceStatusChange', () => {
  it('accepts the liveness slice — the only announcement of an online flip', () => {
    expect(
      isDeviceStatusChange({
        data: { deviceId: 102, capName: DEVICE_STATUS_CAP, slice: { online: false } },
      }),
    ).toBe(true)
  })

  it('rejects every other cap slice — that category is a firehose', () => {
    expect(isDeviceStatusChange({ data: { deviceId: 102, capName: 'battery' } })).toBe(false)
    expect(isDeviceStatusChange({ data: { deviceId: 102, capName: 'feature-probe' } })).toBe(false)
    expect(isDeviceStatusChange({ deviceId: 102 })).toBe(false)
    expect(isDeviceStatusChange(undefined)).toBe(false)
  })
})
