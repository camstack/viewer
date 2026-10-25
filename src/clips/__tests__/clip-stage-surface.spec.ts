/**
 * Every playable clip goes to the camera's own frame. The sheet is a REFUSAL.
 *
 * `ClipStageView`'s docblock named the exit from the sheet and called it
 * "server work and it is not done". It is done — `videoclips.readClipBytes`
 * answers on all three nodes and the hub's broker carries `playClip` (D575).
 *
 * What made the last distinction collapse is D586: the `url` playback kind was
 * unreachable BY CONSTRUCTION. `playbackUrl` lives in `ClipPlaybackSchema` —
 * the output of `getClipPlayback` — and never in `ClipSchema`, the row
 * `listClips` returns, so the viewer read a field the wire does not carry.
 * Measured on the live hub before deleting it: **786 rows across all three
 * sources, not one with a `playbackUrl`**.
 *
 * With that gone there is no second place to play, so there is no choice left
 * to make, so there is no `surface` field. What survives is the one thing the
 * frame cannot do: say why a provider refused.
 */
import { describe, expect, it } from 'vitest'

import { clipSheetShows, clipStageAttach } from '../clip-stage.js'
import type { Clip } from '../clip-model.js'

function clip(over: Partial<Clip> = {}): Clip {
  return {
    clipId: 'c1',
    deviceId: 107,
    startMs: 1_000,
    endMs: 21_000,
    source: 'native:reolink:onboard',
    playback: { kind: 'native', deviceId: 107, clipId: 'native:reolink:onboard:0:abc' },
    ...over,
  } as Clip
}

describe('clipStageAttach', () => {
  it('gives the frame to a playable clip', () => {
    expect(clipStageAttach({ kind: 'session' }, clip()).kind).toBe('clip')
  })

  it('refuses instead, keeping the session picture', () => {
    const refused = { ...clip(), playback: { kind: 'none' }, unplayableReason: 'no file' }
    expect(clipStageAttach({ kind: 'session' }, refused as unknown as Clip).kind).toBe('refused')
  })
})

describe('clipSheetShows — the sheet is where a refusal is said', () => {
  it('is FALSE for a clip: it is in the frame', () => {
    // The visible failure this guards: a sheet opening over the frame that is
    // playing the clip, with nothing in it.
    expect(clipSheetShows(clipStageAttach({ kind: 'session' }, clip()))).toBe(false)
  })

  it('is TRUE for a refusal — the frame has nothing to put on screen', () => {
    expect(clipSheetShows({ kind: 'refused', clipId: 'c1', reason: 'no file' })).toBe(true)
  })

  it('is FALSE while the session holds its own picture', () => {
    expect(clipSheetShows({ kind: 'session' })).toBe(false)
  })
})
