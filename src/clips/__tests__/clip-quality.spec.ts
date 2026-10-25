import { describe, it, expect } from 'vitest'
import { cheapestClipProfile, clipServedMismatch, CLIP_PROFILE_LOW, CLIP_PROFILE_HIGH } from '../clip-quality.js'
import type { Clip } from '../clip-model.js'

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    clipId: 'native:reolink:onboard:0:abc',
    deviceId: 107,
    startMs: 1789933690000,
    endMs: 1789933720000,
    sourceId: 'native:reolink:onboard',
    kind: 'native',
    playback: { kind: 'native', deviceId: 107, clipId: 'native:reolink:onboard:0:abc' },
    ...overrides,
  }
}

describe('cheapestClipProfile', () => {
  it('asks for the SUB file when the row has one', () => {
    // 0.67 MB against 20.0 MB, measured on 592. The timeline is the cheap
    // surface and offers no quality control at all (D559).
    const profile = cheapestClipProfile(
      clip({ streams: { sub: { id: 'a', bytes: 728047 }, main: { id: 'b', bytes: 24762476 } } }),
    )
    expect(profile).toBe(CLIP_PROFILE_LOW)
  })

  it('asks for the MAIN file when that is all there is — 30x, and shown', () => {
    // 17 of 546 rows on 592 day 19 had no sub twin. Hiding those is the "no
    // clips on a camera full of them" defect (D554 4).
    expect(cheapestClipProfile(clip({ streams: { main: { id: 'b', bytes: 24762476 } } }))).toBe(
      CLIP_PROFILE_HIGH,
    )
  })

  it('asks for NOTHING when the row resolved no twins', () => {
    // An older hub, or a row the catalog could not resolve. Naming a profile we
    // cannot justify would make the provider substitute one silently; absence
    // means "your default", which is the only honest ask.
    expect(cheapestClipProfile(clip())).toBeNull()
  })

  it('never asks for `auto` — a stored file has no broker session', () => {
    // `auto` is refused by the cap on purpose: the adaptive tier is resolved
    // from a live session and a file has none. The viewer's live `auto` path
    // must not be reachable from here.
    const profiles = [
      cheapestClipProfile(clip({ streams: { sub: { id: 'a', bytes: 1 } } })),
      cheapestClipProfile(clip({ streams: { main: { id: 'b', bytes: 1 } } })),
      cheapestClipProfile(clip()),
    ]
    expect(profiles).not.toContain('auto')
    expect(profiles).not.toContain('mid')
  })
})

describe('clipServedMismatch', () => {
  it('is silent when the provider served what was asked', () => {
    expect(clipServedMismatch(CLIP_PROFILE_LOW, 'low')).toBeNull()
  })

  it('names the substitution when it did not', () => {
    // D549 15: a missing twin is never served silently as the other. A
    // main-only clip asked at `low` comes back `high`, and 30x the bytes on a
    // phone on cellular is not something the surface may swallow.
    expect(clipServedMismatch(CLIP_PROFILE_LOW, 'high')).toEqual({ asked: 'low', served: 'high' })
  })

  it('is silent when nothing was asked — there is nothing to disagree with', () => {
    expect(clipServedMismatch(null, 'high')).toBeNull()
  })

  it('is silent when the provider said nothing about what it served', () => {
    expect(clipServedMismatch(CLIP_PROFILE_LOW, null)).toBeNull()
  })
})
