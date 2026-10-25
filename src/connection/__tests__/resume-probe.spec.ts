/**
 * When a resume questions the transport, and when it must not.
 *
 * The decision is trivial and the reasoning is not: the input it gates on
 * (`state`) is the very mirror suspected of lying, so the rule has to be stated
 * in terms of what a wrong answer COSTS in each direction. See `resume-probe.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  decideResumeProbe,
  RESUME_PROBE_DEADLINE_MS,
  RESUME_PROBE_MIN_AWAY_MS,
} from '../resume-probe.js'

describe('decideResumeProbe', () => {
  it('probes after a real suspension', () => {
    expect(decideResumeProbe({ awayMs: 8 * 3_600_000, state: 'connected' })).toBe('probe')
  })

  it('probes when the away time was never recorded', () => {
    // A listener attached mid-session, or a first foreground. Unknown is not
    // "brief": the whole point is that we cannot tell from the mirror.
    expect(decideResumeProbe({ awayMs: null, state: 'connected' })).toBe('probe')
  })

  it('leaves a glance alone — the app was obscured, not suspended', () => {
    // The shade, the app switcher, a permission sheet. The socket cannot have
    // died, and a round-trip per glance is a battery cost with no reader.
    expect(decideResumeProbe({ awayMs: RESUME_PROBE_MIN_AWAY_MS - 1, state: 'connected' })).toBe(
      'brief-away',
    )
  })

  it('does not question a transport that already knows it is down', () => {
    // It is dialling on its own backoff. A probe here adds a doomed round-trip
    // and a redundant rebuild to a recovery already in progress.
    expect(decideResumeProbe({ awayMs: 60_000, state: 'disconnected' })).toBe('already-down')
    expect(decideResumeProbe({ awayMs: 60_000, state: 'connecting' })).toBe('already-down')
  })

  it('answers well inside the keep-alive it stands in for', () => {
    // tRPC's keep-alive is a 10 s interval plus a 6 s pong timeout, and both
    // were frozen for the whole suspension. A deadline anywhere near that would
    // buy nothing.
    expect(RESUME_PROBE_DEADLINE_MS).toBeLessThan(10_000)
  })
})
