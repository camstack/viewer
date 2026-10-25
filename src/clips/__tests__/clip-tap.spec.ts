import { describe, it, expect } from 'vitest'
import { resolveClipTap } from '../clip-tap.js'
import type { Clip } from '../clip-model.js'

const T0 = 1789933690000

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    clipId: 'c1',
    deviceId: 107,
    startMs: T0,
    endMs: T0 + 30_000,
    sourceId: 'analytics',
    kind: 'motion',
    playback: { kind: 'recorded', deviceId: 107 },
    ...overrides,
  }
}

const nativeRef = { kind: 'native', deviceId: 107, clipId: 'n1' } as const

describe('resolveClipTap', () => {
  it('seeks OUR footage for a recorded clip, by epoch', () => {
    expect(resolveClipTap(clip())).toEqual({ kind: 'seek', epochMs: T0 })
  })

  it('opens a FILE for a native clip — the recorded transport cannot reach it', () => {
    // The recorded transport seeks by epoch into footage we hold. A file on the
    // camera's SD card is not in it, so a seek would land on whatever our
    // recorder happened to have at that instant, or on nothing.
    const tap = resolveClipTap(
      clip({ clipId: 'n1', sourceId: 'native:reolink:onboard', kind: 'native', playback: nativeRef }),
    )
    expect(tap).toEqual({ kind: 'file', deviceId: 107, clipId: 'n1', profile: null })
  })

  it('asks for the CHEAPEST copy the row resolved', () => {
    // The timeline is the cheap surface (D559) — 0.67 MB rather than 20.0 MB.
    const tap = resolveClipTap(
      clip({
        clipId: 'n1',
        sourceId: 'native:reolink:onboard',
        playback: nativeRef,
        streams: { sub: { id: 'a', bytes: 728047 }, main: { id: 'b', bytes: 24762476 } },
      }),
    )
    expect(tap).toEqual({ kind: 'file', deviceId: 107, clipId: 'n1', profile: 'low' })
  })

  it('asks for the main file when that is the only copy there is', () => {
    const tap = resolveClipTap(
      clip({
        clipId: 'n1',
        sourceId: 'native:reolink:onboard',
        playback: nativeRef,
        streams: { main: { id: 'b', bytes: 24762476 } },
      }),
    )
    expect(tap).toEqual({ kind: 'file', deviceId: 107, clipId: 'n1', profile: 'high' })
  })

  it('refuses a clip the provider said is not playable', () => {
    // Not a silent no-op: the surface has the reason and must be able to say it.
    const tap = resolveClipTap(
      clip({
        clipId: 'n1',
        sourceId: 'native:reolink:onboard',
        playback: nativeRef,
        playable: false,
        unplayableReason: 'file is still being written',
      }),
    )
    expect(tap).toEqual({ kind: 'refused', reason: 'file is still being written' })
  })

  it('refuses without a reason rather than inventing one', () => {
    const tap = resolveClipTap(
      clip({ clipId: 'n1', sourceId: 'native:reolink:onboard', playback: nativeRef, playable: false }),
    )
    expect(tap).toEqual({ kind: 'refused', reason: null })
  })

  it('has no URL tap at all — that kind was unreachable by construction', () => {
    // `playbackUrl` lives in `ClipPlaybackSchema`, the output of
    // `getClipPlayback`, and never in `ClipSchema`, the row `listClips`
    // returns. The viewer read a field the wire does not carry: 786 live rows
    // across three sources, none with one. Deleted rather than left as a
    // supported case (D586), so every playable clip now resolves to the same
    // two taps.
    const taps = new Set(
      [
        resolveClipTap(
          clip({
            clipId: 'n1',
            sourceId: 'native:reolink:onboard',
            playback: { kind: 'native', deviceId: 107, clipId: 'n1' },
          }),
        ),
        resolveClipTap(clip({ clipId: 'r1', sourceId: 'analytics' })),
      ].map((t) => t.kind),
    )
    expect(taps).toEqual(new Set(['file', 'seek']))
  })
})
