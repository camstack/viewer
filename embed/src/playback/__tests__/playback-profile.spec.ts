import { describe, it, expect } from 'vitest'
import {
  resolvePlaybackEntryProfile,
  resolvePlaybackUpgradeProfile,
} from '../playback-profile.js'

describe('resolvePlaybackEntryProfile', () => {
  it('always enters adaptive playback on the lowest rung', () => {
    expect(resolvePlaybackEntryProfile({ kind: 'adaptive' }, 'high')).toBe('low')
    expect(resolvePlaybackEntryProfile({ kind: 'adaptive' }, 'mid')).toBe('low')
    expect(resolvePlaybackEntryProfile({ kind: 'adaptive' }, 'low')).toBe('low')
  })

  it('honours a pinned profile exactly', () => {
    expect(resolvePlaybackEntryProfile({ kind: 'profile', profile: 'high' }, 'low')).toBe('high')
    expect(resolvePlaybackEntryProfile({ kind: 'profile', profile: 'mid' }, 'low')).toBe('mid')
  })
})

describe('resolvePlaybackUpgradeProfile', () => {
  it('picks low / mid / high from the downlink, so mid is on the ladder', () => {
    expect(resolvePlaybackUpgradeProfile({ kind: 'adaptive' }, 1)).toBe('low')
    expect(resolvePlaybackUpgradeProfile({ kind: 'adaptive' }, 4)).toBe('mid')
    expect(resolvePlaybackUpgradeProfile({ kind: 'adaptive' }, 20)).toBe('high')
  })

  it('does not override a pinned profile with the probe', () => {
    expect(resolvePlaybackUpgradeProfile({ kind: 'profile', profile: 'high' }, 1)).toBe('high')
  })
})
