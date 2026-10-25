import { describe, it, expect } from 'vitest'
import { buildPlayerEmbedConfig } from '../embed-player-config.js'

describe('buildPlayerEmbedConfig', () => {
  it('maps a connection + target into the injected config shape', () => {
    const cfg = buildPlayerEmbedConfig({ serverUrl: 'https://hub.local', token: 'jwt', deviceId: 7, target: { kind: 'adaptive' }, muted: true, stats: false })
    expect(cfg).toEqual({ serverUrl: 'https://hub.local', token: 'jwt', deviceId: 7, target: { kind: 'adaptive' }, muted: true, stats: false })
  })
  it('includes snapshot/highlight only when provided', () => {
    const cfg = buildPlayerEmbedConfig({ serverUrl: 'https://hub.local', token: 'jwt', deviceId: 7, target: { kind: 'adaptive' }, muted: false, stats: true, snapshot: 'data:image/png;base64,xxx' })
    expect(cfg.snapshot).toBe('data:image/png;base64,xxx')
    expect('highlight' in cfg).toBe(false)
  })

  describe('recorded-playback config', () => {
    const base = {
      serverUrl: 'https://hub.local',
      token: 'jwt',
      deviceId: 7,
      target: { kind: 'adaptive' } as const,
      muted: true,
      stats: false,
    }

    it('passes initialSeekMs through only when provided (deep-link go-to-moment)', () => {
      const withSeek = buildPlayerEmbedConfig({ ...base, initialSeekMs: 1_723_800_000_000 })
      expect(withSeek.initialSeekMs).toBe(1_723_800_000_000)
      const bare = buildPlayerEmbedConfig(base)
      expect('initialSeekMs' in bare).toBe(false)
    })

    it('does not inject removed feeder/HLS/WebCodecs mode flags', () => {
      const cfg = buildPlayerEmbedConfig(base)
      expect(cfg).toEqual(base)
      expect('webcodecsRecordedPlayback' in cfg).toBe(false)
      expect('hlsRecordedPlayback' in cfg).toBe(false)
      expect('feederScrub' in cfg).toBe(false)
    })
  })
})
