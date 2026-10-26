/**
 * The viewer copy of the device-name rule. The byte check
 * (`scripts/check-device-name-in-sync.ts` in camstack-server) is the parity
 * with the canonical file. These cases are the two branches a screen will
 * hit first: the only meaningful child of a container, and a siren under a
 * camera (the camera is not a container, so the line stays `camera · noun`).
 * The ten hub rows live next to the canonical function.
 */
import { describe, expect, it } from 'vitest'
import { formatDeviceName, type DeviceNameFields, type DeviceNameNouns } from '../device-name'

const NOUNS: DeviceNameNouns = {
  shortNoun(role, type) {
    if (role === 'motion-sensor') return 'Movimento'
    if (type === 'siren') return 'Sirena'
    return type
  },
  isStockPhrase(text, role, type) {
    if (role === 'motion-sensor' && text.toLowerCase() === 'motion') return true
    if (type === 'siren' && text.toLowerCase() === 'siren') return true
    return false
  },
}

function device(partial: DeviceNameFields): DeviceNameFields {
  return partial
}

describe('viewer device-name copy', () => {
  it('names the only motion child as its container', () => {
    const parent = device({
      id: 3297,
      name: 'Sensore movimento veranda',
      type: 'container',
      stableId: 'p',
      parentDeviceId: null,
    })
    const motion = device({
      id: 3299,
      name: 'Motion',
      type: 'sensor',
      role: 'motion-sensor',
      stableId: 'm',
      parentDeviceId: 3297,
    })
    expect(
      formatDeviceName(motion, 'compact', { parent, siblings: [motion] }, NOUNS),
    ).toBe('Sensore movimento veranda')
  })

  it('keeps a siren under a camera as camera · noun', () => {
    const camera = device({
      id: 584,
      name: 'Videocamera veranda',
      type: 'camera',
      stableId: 'c',
      parentDeviceId: null,
    })
    const siren = device({
      id: 585,
      name: 'Videocamera veranda Siren',
      type: 'siren',
      stableId: 's',
      parentDeviceId: 584,
    })
    expect(formatDeviceName(siren, 'compact', { parent: camera, siblings: [siren] }, NOUNS)).toBe(
      'Videocamera veranda · Sirena',
    )
  })
})
