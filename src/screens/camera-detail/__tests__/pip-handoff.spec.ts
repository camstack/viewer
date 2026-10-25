import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requestSystemPip, type PipRequestPorts } from '../pip-handoff.js'
import type { PipStartResult } from '../../../live/pip-request.js'
import type { PlaybackMode } from '../../../recording/playback-machine.js'

/**
 * The disc hands the SESSION over to system PiP — and stays.
 *
 * The SWIPE used to do it too. It was removed on 2026-09-13: PiP is now an
 * automatism on app close, and the two downward flings mean "go back" (one
 * finger) and "on-demand overlay, then go back" (two). `stream-swipes.ts` is
 * the record of that.
 *
 *  1. From recorded playback the player must be back LIVE before PiP is asked
 *     (PiP of a dying recorded session pictures the playhead, or nothing).
 *  2. Nothing here navigates. The swipe used to leave once PiP was confirmed,
 *     and the window died with the screen: measured on the device (the
 *     parking guard spec next to this one), a WKWebView that is not visible is
 *     throttled and its PiP closes — the route was never what kept it alive,
 *     visibility was. So a `navigateBack` port does not exist any more, and
 *     the guard below fails the moment one comes back.
 *
 * The order is asserted BY VALUE — a recorded call sequence, not a source grep.
 */

interface Recorder {
  readonly calls: string[]
  readonly ports: PipRequestPorts
  resolveLive: (outcome: 'live' | 'failed') => void
  resolvePip: (result: PipStartResult) => void
}

function recorder(mode: PlaybackMode): Recorder {
  const calls: string[] = []
  let liveResolver: ((o: 'live' | 'failed') => void) | null = null
  let pipResolver: ((r: PipStartResult) => void) | null = null
  const ports: PipRequestPorts = {
    mode,
    goLive: () => void calls.push('goLive'),
    awaitLive: () => {
      calls.push('awaitLive')
      return new Promise<'live' | 'failed'>((res) => {
        liveResolver = res
      })
    },
    startPip: () => {
      calls.push('startPip')
      return new Promise<PipStartResult>((res) => {
        pipResolver = res
      })
    },
  }
  return {
    calls,
    ports,
    resolveLive: (o) => liveResolver?.(o),
    resolvePip: (r) => pipResolver?.(r),
  }
}

/** Let every already-settled microtask run. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('requestSystemPip', () => {
  it('starts PiP on the current session when the player is already live', async () => {
    const r = recorder('live')
    const done = requestSystemPip(r.ports)
    await settle()
    expect(r.calls).toEqual(['startPip'])
    r.resolvePip('started')
    await expect(done).resolves.toBe('started')
  })

  it('from recorded playback: goLive, WAIT for live, only then PiP', async () => {
    const r = recorder('playback')
    const done = requestSystemPip(r.ports)
    await settle()
    // PiP has NOT been asked yet — the recorded session is still the one on screen.
    expect(r.calls).toEqual(['goLive', 'awaitLive'])
    r.resolveLive('live')
    await settle()
    expect(r.calls).toEqual(['goLive', 'awaitLive', 'startPip'])
    r.resolvePip('started')
    await expect(done).resolves.toBe('started')
  })

  it('never asks for PiP when the player failed to come back live', async () => {
    const r = recorder('seeking')
    const done = requestSystemPip(r.ports)
    await settle()
    r.resolveLive('failed')
    await expect(done).resolves.toBe('unavailable')
    expect(r.calls).not.toContain('startPip')
  })

  it('does nothing but the request, whatever the answer', async () => {
    for (const result of ['started', 'unavailable', 'unconfirmed'] as const) {
      const r = recorder('live')
      const done = requestSystemPip(r.ports)
      await settle()
      r.resolvePip(result)
      await expect(done).resolves.toBe(result)
      expect(r.calls).toEqual(['startPip'])
    }
  })
})

describe('system PiP is asked by the disc, and the screen stays', () => {
  const ROOT = process.cwd()
  const screen = readFileSync(join(ROOT, 'src/screens/CameraDetailScreen.tsx'), 'utf8')
  const handoff = readFileSync(join(ROOT, 'src/screens/camera-detail/pip-handoff.ts'), 'utf8')

  it('no FLING asks for PiP any more', () => {
    // The operator removed the finger-PiP on 2026-09-13. PiP is now what
    // happens automatically when the app is closed on a single camera, behind a
    // global setting — and a gesture competing with that automatism would be
    // two authorities over one behaviour.
    //
    // Asserted as an ABSENCE, on purpose: the way this comes back is somebody
    // re-adding a handler because the file still looked like it wanted one.
    expect(screen).not.toContain('onSwipeToPip')
    expect(screen).not.toContain('shouldStartPipOnSwipe')
  })

  it('the disc still asks the same sequencer — now through the shared hook', () => {
    // `live/use-system-pip.ts` since 2026-09-13: the on-demand overlay presses
    // the same button and the ordering is asserted in one place, not two.
    expect(screen).toContain('useSystemPip(')
    const hook = readFileSync(join(ROOT, 'src/live/use-system-pip.ts'), 'utf8')
    expect(hook).toContain('requestSystemPip(ports)')
  })

  it('and no port navigates — the navigating swipe is gone with its name', () => {
    expect(handoff).not.toContain('navigateBack')
    expect(handoff).not.toContain('swipeBackThroughPip')
    expect(screen).not.toContain('navigateBack')
    expect(screen).not.toContain('swipeBackThroughPip')
  })

  it('the reason is written where the next reader will look', () => {
    expect(handoff).toContain('not VISIBLE')
    expect(handoff).toContain('UIApplication.suspend')
  })
})
