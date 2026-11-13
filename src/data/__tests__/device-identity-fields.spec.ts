import { describe, expect, it } from 'vitest'
import { deviceSeenAt, parentDeviceIdOf, reachabilityOf } from '../device-identity-fields.js'

describe('device identity fields the accessory mapping drops', () => {
  it('treats a missing online as Unknown and a false as Offline', () => {
    expect(reachabilityOf(undefined)).toBe('unknown')
    expect(reachabilityOf(null)).toBe('unknown')
    expect(reachabilityOf(false)).toBe('offline')
    expect(reachabilityOf(true)).toBe('online')
  })

  it('drops an epoch instant and keeps a later last-update when last-seen is 0', () => {
    expect(deviceSeenAt({ lastSeen: 0 })).toBeNull()
    expect(deviceSeenAt({ lastSeen: 0, updatedAt: 50 })).toEqual({ kind: 'updated', ms: 50 })
    expect(deviceSeenAt({ lastSeen: 80, updatedAt: 50 })).toEqual({ kind: 'seen', ms: 80 })
    expect(deviceSeenAt({})).toBeNull()
  })

  it('reads a parent id only when the row carries a number', () => {
    expect(parentDeviceIdOf({ parentDeviceId: 9 })).toBe(9)
    expect(parentDeviceIdOf({ parentDeviceId: null })).toBeNull()
    expect(parentDeviceIdOf({})).toBeNull()
  })
})
