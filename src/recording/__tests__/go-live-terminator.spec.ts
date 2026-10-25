import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  initialPlaybackState,
  makePlaybackBridge,
  playbackReducer,
  type PlaybackControlSink,
  type PlaybackMode,
  type PlaybackState,
} from '../playback-machine.js'

/**
 * The GO-LIVE ECHO has exactly one terminator, and this file is what stops the
 * next person removing it.
 *
 * ## The loop, as it actually ran on device 3629
 *
 * `use-timeline-scrub.ts` fires a go-live when the scroller sits at the live
 * edge, and its ONLY brake is the flag:
 *
 *     case 'goLive':
 *       if (!isLiveRef.current) onGoLive()
 *
 * `isLive` is `props.mode === 'live' && activeEpoch === null`. So the echo stops
 * because `onGoLive()` puts the machine into `live`, which raises the flag,
 * which suppresses the next echo. **The brake is the machine reaching `live`.**
 *
 * 1.0.512 added a `clip` mode that could not be left by `GO_LIVE` and whose
 * bridge withheld the call. The flag could then never rise, and the echo had
 * nothing to stop it. Every pass ran `goLiveFelt`, whose first statement is
 * `hapticTap()` — *"sento la vibrazione continua e non posso più muovere"*,
 * with the scroller re-anchored on every pass so the timeline looked frozen at
 * one instant.
 *
 * It needed the scroller to BE at the live edge, which is why it reproduced on
 * "Camera porta retro" (3629: a sleeping battery camera, 10 clips, so the
 * compressed axis is a few hundred px and the list sits pinned at the top) and
 * not on 592 (mains, 357 clips, a tapped card thousands of px down).
 *
 * ## The invariant
 *
 * A mode in which `goLive()` does not reach `live` is a loop waiting for a
 * short list. So: **every mode must be leavable by GO_LIVE, and GO_LIVE must
 * always reach the machine.** The clips surface earns its detachment by not
 * being a mode of this machine at all (D570) — not by adding a mode this test
 * would have to exempt.
 */

const EVERY_MODE: readonly PlaybackMode[] = ['live', 'seeking', 'playback', 'gap', 'error']

function inMode(mode: PlaybackMode): PlaybackState {
  return { ...initialPlaybackState, mode, playhead: mode === 'live' ? null : 1_789_900_000_000 }
}

describe('every mode this machine can be in is leavable by GO_LIVE', () => {
  it('knows every mode the union declares — a new one cannot skip this file', () => {
    // Read off the SOURCE, not off a hand-kept list: the failure this guards
    // is someone adding a mode and not proving it leavable, and a hand-kept
    // list is exactly what such a person would also forget to update.
    const src = readFileSync(join(process.cwd(), 'src', 'recording', 'playback-machine.ts'), 'utf8')
    const line = /export type PlaybackMode =([^\n]*)/.exec(src)?.[1] ?? ''
    const declared = [...line.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    expect(declared).toEqual([...EVERY_MODE].sort())
  })

  for (const mode of EVERY_MODE) {
    it(`GO_LIVE from '${mode}' lands on live in ONE dispatch`, () => {
      const after = playbackReducer(inMode(mode), { type: 'GO_LIVE' })
      expect(after.mode).toBe('live')
      expect(after.playhead).toBeNull()
    })
  }
})

describe('the echo costs a BOUNDED number of dispatches, not one per scroll frame', () => {
  it('ten go-live echoes produce one transition and then nothing', () => {
    // This is the shape `use-timeline-scrub` really has: the brake is read
    // from the machine, so the count is what matters, not the value. Asserting
    // `mode === 'live'` ten times would pass against the looping build too.
    const dispatched: string[] = []
    const sink: PlaybackControlSink = {
      scrubStart: vi.fn(),
      scrubTo: vi.fn(),
      scrubCommit: vi.fn(),
      seek: vi.fn(),
      goLive: vi.fn(),
    }
    let state = inMode('playback')
    const bridge = makePlaybackBridge(sink, (action) => {
      dispatched.push(action.type)
      state = playbackReducer(state, action)
    }, { current: 0 })

    for (let i = 0; i < 10; i++) {
      // The scrub hook's own brake, reproduced exactly.
      const isLive = state.mode === 'live' && state.playhead === null
      if (!isLive) bridge.goLive()
    }

    expect(dispatched).toEqual(['GO_LIVE'])
    expect(sink.goLive).toHaveBeenCalledTimes(1)
  })
})
