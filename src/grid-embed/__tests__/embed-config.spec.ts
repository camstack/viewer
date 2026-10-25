import { describe, it, expect } from 'vitest'
import { buildGridEmbedConfig } from '../embed-config.js'

describe('buildGridEmbedConfig', () => {
  const base = {
    serverUrl: 'https://hub.local',
    token: 'jwt-123',
    deviceIds: [7, 8, 9],
    options: { showName: true, quality: 'auto', layout: 'auto' } as const,
    muted: true,
    paused: false,
  }

  it('maps a resolved grid into the server embed-config shape', () => {
    const c = buildGridEmbedConfig(base)
    expect(c).toEqual({
      serverUrl: 'https://hub.local',
      token: 'jwt-123',
      devices: [7, 8, 9],
      layout: 'auto',
      quality: 'auto',
      showName: true,
      showBadges: true,
      muted: true,
      paused: false,
    })
  })

  it('carries a fixed numeric layout through', () => {
    const c = buildGridEmbedConfig({ ...base, options: { ...base.options, layout: 3 } })
    expect(c.layout).toBe(3)
  })

  it('carries quality and showName through', () => {
    const c = buildGridEmbedConfig({ ...base, options: { showName: false, quality: 'high', layout: 'auto' } })
    expect(c.quality).toBe('high')
    expect(c.showName).toBe(false)
  })

  it('preserves device order and does not mutate the input array', () => {
    const ids = [9, 7, 8]
    const c = buildGridEmbedConfig({ ...base, deviceIds: ids })
    expect(c.devices).toEqual([9, 7, 8])
    expect(ids).toEqual([9, 7, 8])
    expect(c.devices).not.toBe(ids)
  })

  it('defaults showBadges to true (event badges are a server-side follow-up)', () => {
    expect(buildGridEmbedConfig(base).showBadges).toBe(true)
  })

  it('includes showBoxes only when set (config stays identical otherwise)', () => {
    expect(buildGridEmbedConfig(base).showBoxes).toBeUndefined()
    expect(buildGridEmbedConfig({ ...base, showBoxes: false }).showBoxes).toBeUndefined()
    expect(buildGridEmbedConfig({ ...base, showBoxes: true }).showBoxes).toBe(true)
  })
})
