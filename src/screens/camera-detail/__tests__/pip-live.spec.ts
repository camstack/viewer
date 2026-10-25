/**
 * PiP of a camera must show LIVE, never the recorded playhead the operator
 * was scrubbing. Pure helpers so the gate is unit-tested without mounting
 * CameraDetailScreen.
 */
import { describe, it, expect } from 'vitest'
import { shouldGoLiveBeforePip, pipReadyAfterGoLive, goLiveFailedBeforePip } from '../pip-live.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('shouldGoLiveBeforePip', () => {
  it('is false while already live — PiP can start on the current session', () => {
    expect(shouldGoLiveBeforePip('live')).toBe(false)
  })

  it('is true for every non-live machine mode', () => {
    expect(shouldGoLiveBeforePip('playback')).toBe(true)
    expect(shouldGoLiveBeforePip('seeking')).toBe(true)
    expect(shouldGoLiveBeforePip('gap')).toBe(true)
    expect(shouldGoLiveBeforePip('error')).toBe(true)
  })
})

describe('pipReadyAfterGoLive', () => {
  it('waits until the remounted player is actually playing', () => {
    // goLive remounts the WebView; startPip injected into the dying session
    // would PiP the recorded <video> (or nothing).
    expect(pipReadyAfterGoLive({ pending: true, mode: 'live', playerState: 'connecting' })).toBe(false)
    expect(pipReadyAfterGoLive({ pending: true, mode: 'playback', playerState: 'playing' })).toBe(false)
    expect(pipReadyAfterGoLive({ pending: false, mode: 'live', playerState: 'playing' })).toBe(false)
    expect(pipReadyAfterGoLive({ pending: true, mode: 'live', playerState: 'playing' })).toBe(true)
  })
})

describe('goLiveFailedBeforePip', () => {
  it('is the OTHER end of the wait: an error means no live session is coming', () => {
    // Without it the pending request waits forever on a player that will never
    // play, and the swipe silently does nothing for the rest of the session.
    expect(goLiveFailedBeforePip('error')).toBe(true)
    expect(goLiveFailedBeforePip('connecting')).toBe(false)
    expect(goLiveFailedBeforePip('playing')).toBe(false)
  })
})

/**
 * The wiring moved on 2026-09-13: the waiter, the gate and the sequencer call
 * now live in `live/use-system-pip.ts`, because the on-demand overlay grew a
 * PiP button and a second copy of a sequence whose whole point is ORDERING is
 * how the two drift. The guards below therefore point at the hook — and at
 * every surface that presses the button, so a third one cannot quietly
 * rebuild the sequence for itself.
 */
describe('the PiP hook wires the request through the live gate', () => {
  const src = readFileSync(join(process.cwd(), 'src/live/use-system-pip.ts'), 'utf8')

  it('does not start PiP blindly on the current session', () => {
    // A one-liner that always calls startPip on the current session would PiP
    // the playhead the operator was scrubbing.
    expect(src).not.toMatch(/const onStartPip = useCallback\(\(\) => liveRef\.current\?\.startPip\(\), \[\]\)/)
    expect(src).toContain('requestSystemPip')
  })

  it('goes live first when the machine is not live, then starts PiP once playing', () => {
    expect(src).toContain('pipReadyAfterGoLive')
    expect(src).toContain('goLiveFailedBeforePip')
  })

  it('waits for the LIVE session through the gate, never through a timer', () => {
    // A setTimeout here is the defect: it PiPs on a guess.
    const start = src.indexOf('awaitLive')
    expect(start).toBeGreaterThan(-1)
    expect(src.slice(start, start + 1400)).not.toContain('setTimeout')
  })
})

describe('and every surface with a PiP button goes through it', () => {
  for (const rel of [
    'src/screens/CameraDetailScreen.tsx',
    'src/components/camera/OnDemandPlayer.tsx',
  ]) {
    const src = readFileSync(join(process.cwd(), rel), 'utf8')

    it(`${rel} presses the hook, and supplies its OWN go-live`, () => {
      expect(src).toContain('useSystemPip(')
      // The remounts genuinely differ (the screen also flips its player status
      // to `connecting`; the overlay bumps its reload key), so the go-live is
      // the caller's — but the decision to CALL it is not.
      expect(src).not.toContain('pipReadyAfterGoLive')
      expect(src).not.toContain('requestSystemPip(')
    })
  }
})
