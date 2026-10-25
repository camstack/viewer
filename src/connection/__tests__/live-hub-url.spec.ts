import { describe, it, expect } from 'vitest'
import { pickLiveHubUrl } from '../live-hub-url.js'

const TUNNEL = 'https://camstack.example.top'
const LAN = 'http://192.0.2.10:4480'

describe('pickLiveHubUrl', () => {
  it('prefers the raced live route over the configured tunnel', () => {
    expect(pickLiveHubUrl(LAN, TUNNEL)).toBe(LAN)
  })

  it('falls back to the configured URL before the transport exists', () => {
    expect(pickLiveHubUrl(null, TUNNEL)).toBe(TUNNEL)
    expect(pickLiveHubUrl(undefined, TUNNEL)).toBe(TUNNEL)
    expect(pickLiveHubUrl('', TUNNEL)).toBe(TUNNEL)
  })

  it('is null when neither is known', () => {
    expect(pickLiveHubUrl(null, null)).toBeNull()
  })
})
