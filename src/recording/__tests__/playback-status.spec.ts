import { describe, it, expect } from 'vitest'
import { derivePlaybackStatus, jogBaseFor, jogTarget, resolveJogBase, resolveInitialSeekAction, JOG_MS, eventMomentSeekMs } from '../playback-status'

describe('derivePlaybackStatus', () => {
  it('shows LIVE when mode is live', () => {
    expect(derivePlaybackStatus({ mode: 'live', playheadEpoch: null })).toEqual({ isLive: true, label: 'LIVE', showGoLive: false })
  })
  it('shows the playhead clock when playing/paused', () => {
    const epoch = new Date('2026-06-16T12:47:03Z').getTime()
    const r = derivePlaybackStatus({ mode: 'playing', playheadEpoch: epoch })
    expect(r.isLive).toBe(false)
    expect(r.showGoLive).toBe(true)
    expect(r.label).toMatch(/\d{2}:47:03$/) // HH:MM:SS in local tz; assert the m:s tail
  })
  it('falls back to a loading label when recorded but no playhead yet', () => {
    expect(derivePlaybackStatus({ mode: 'loading', playheadEpoch: null })).toEqual({ isLive: false, label: '…', showGoLive: true })
  })
  it('shows a gap label in a no-footage region', () => {
    expect(derivePlaybackStatus({ mode: 'gap', playheadEpoch: null }).label).toBe('No footage')
  })
  it('shows an error label on error', () => {
    expect(derivePlaybackStatus({ mode: 'error', playheadEpoch: null }).label).toBe('Error')
  })
})

describe('jogTarget', () => {
  it('adds/subtracts 10s from the current playhead', () => {
    expect(jogTarget(100000, 1)).toBe(100000 + JOG_MS)
    expect(jogTarget(100000, -1)).toBe(100000 - JOG_MS)
  })
  it('returns null when there is no playhead (live)', () => {
    expect(jogTarget(null, 1)).toBeNull()
  })
})

describe('eventMomentSeekMs', () => {
  it('lands on the event timestamp itself', () => {
    expect(eventMomentSeekMs(100_000)).toBe(100_000)
  })
  it('clamps to the recording floor when the caller knows one', () => {
    expect(eventMomentSeekMs(100_000, 105_000)).toBe(105_000)
    expect(eventMomentSeekMs(100_000, 80_000)).toBe(100_000)
  })
  it('rounds once so ?at= and the overlay cannot disagree by a fraction', () => {
    expect(eventMomentSeekMs(100_000.7)).toBe(Math.round(100_000.7))
  })
})

describe('resolveJogBase', () => {
  it('prefers the playhead when present', () => {
    expect(resolveJogBase(100000, 200000)).toBe(100000)
  })
  it('falls back to the active epoch when the playhead is null', () => {
    expect(resolveJogBase(null, 200000)).toBe(200000)
  })
  it('is null only when both playhead and fallback are null', () => {
    expect(resolveJogBase(null, null)).toBeNull()
  })
  it('lets a jog off a settling seek use the seek-preview epoch (no no-op)', () => {
    // playhead null mid-seek, but the indicator's active epoch is known → jog works.
    const base = resolveJogBase(null, 500000)
    expect(jogTarget(base, -1)).toBe(500000 - JOG_MS)
  })
})

describe('resolveInitialSeekAction', () => {
  it('a recorded-flow report means the embed already honoured the config-carried seek -> adopt', () => {
    for (const mode of ['loading', 'playing', 'paused', 'gap'] as const) {
      expect(resolveInitialSeekAction(mode)).toBe('adopt')
    }
  })
  it('a live or error report means the embed ignored (or failed) the config seek -> host-driven seek', () => {
    for (const mode of ['live', 'error'] as const) {
      expect(resolveInitialSeekAction(mode)).toBe('seek')
    }
  })
})

describe('jogBaseFor — where a jog measures from', () => {
  it('normally the playhead', () => {
    expect(jogBaseFor(false, 100, 50)).toBe(100)
  })

  it('while a selection is armed, the free end (the active epoch), not the held playhead', () => {
    expect(jogBaseFor(true, 100, 80)).toBe(80)
  })

  it('an armed jog with no preview yet falls back to the playhead', () => {
    expect(jogBaseFor(true, 100, null)).toBe(100)
  })
})
