import { describe, it, expect } from 'vitest'
import { nextPhase, type PresencePhase } from '../presence.js'

describe('nextPhase', () => {
  it('activating from hidden waits out the delay before showing', () => {
    expect(nextPhase('hidden', 'activate')).toBe('waiting')
    expect(nextPhase('waiting', 'delayElapsed')).toBe('shown')
  })

  it('a brief blip (deactivate while waiting) never shows the indicator', () => {
    expect(nextPhase('waiting', 'deactivate')).toBe('hidden')
  })

  it('deactivating while shown animates out, then hides', () => {
    expect(nextPhase('shown', 'deactivate')).toBe('leaving')
    expect(nextPhase('leaving', 'exitDone')).toBe('hidden')
  })

  it('re-activating mid-exit returns straight to shown (no re-delay)', () => {
    expect(nextPhase('leaving', 'activate')).toBe('shown')
  })

  it('redundant events are no-ops', () => {
    const cases: readonly (readonly [PresencePhase, PresencePhase])[] = [
      ['hidden', nextPhase('hidden', 'deactivate')],
      ['waiting', nextPhase('waiting', 'activate')],
      ['shown', nextPhase('shown', 'activate')],
      ['leaving', nextPhase('leaving', 'deactivate')],
      ['shown', nextPhase('shown', 'delayElapsed')],
      ['hidden', nextPhase('hidden', 'exitDone')],
    ]
    for (const [expected, actual] of cases) expect(actual).toBe(expected)
  })

  it('stale timer events cannot resurrect a hidden indicator', () => {
    expect(nextPhase('hidden', 'delayElapsed')).toBe('hidden')
    expect(nextPhase('waiting', 'exitDone')).toBe('waiting')
  })
})
