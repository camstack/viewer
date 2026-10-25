import { describe, expect, it } from 'vitest'

import {
  CLIP_POSITION_EPOCH_FLOOR_MS,
  clipOffsetAtFraction,
  fractionAtX,
  resolveClipDuration,
  resolveClipProgress,
  routePlayerPosition,
} from '../clip-progress.js'
import { clipStageAttach, initialClipStage } from '../clip-stage.js'
import type { Clip } from '../clip-model.js'

const CLOSED: Clip = {
  clipId: 'clip-closed',
  deviceId: 107,
  startMs: 1_700_000_000_000,
  endMs: 1_700_000_016_000,
  sourceId: 'native:reolink:onboard',
  kind: 'motion',
  playback: { kind: 'native', deviceId: 107, clipId: 'clip-closed' },
}

const GROWING: Clip = { ...CLOSED, clipId: 'clip-growing', inProgress: true }

describe('resolveClipDuration — measured, or the catalog span, or unknown', () => {
  it('the broker measure wins over the catalog span', () => {
    expect(
      resolveClipDuration({ measuredMs: 16_240, startMs: 0, endMs: 99_000, inProgress: false }),
    ).toEqual({ ms: 16_240, source: 'measured' })
  })

  it('a CLOSED clip with no measure yet borrows the catalog span', () => {
    expect(
      resolveClipDuration({ measuredMs: null, startMs: CLOSED.startMs, endMs: CLOSED.endMs, inProgress: false }),
    ).toEqual({ ms: 16_000, source: 'index' })
  })

  it('a GROWING clip never borrows the span — its catalog end is frozen (592, eight minutes)', () => {
    expect(
      resolveClipDuration({ measuredMs: null, startMs: CLOSED.startMs, endMs: CLOSED.endMs, inProgress: true }),
    ).toEqual({ ms: null, source: 'unknown' })
  })

  it('a growing clip DOES take the broker measure — the file itself is what was measured', () => {
    expect(
      resolveClipDuration({ measuredMs: 480_000, startMs: CLOSED.startMs, endMs: CLOSED.endMs, inProgress: true }),
    ).toEqual({ ms: 480_000, source: 'measured' })
  })

  it('a failed measure is unknown, never zero (D393)', () => {
    for (const measuredMs of [0, -5, Number.NaN]) {
      expect(resolveClipDuration({ measuredMs, startMs: 0, endMs: 0, inProgress: false }).ms).toBeNull()
    }
    expect(resolveClipDuration({ measuredMs: null, startMs: 10, endMs: 10, inProgress: false })).toEqual({
      ms: null,
      source: 'unknown',
    })
  })
})

describe('resolveClipProgress — a fraction only when both sides are known', () => {
  it('is null-fractioned before the first report and while the length is unknown', () => {
    expect(resolveClipProgress(null, { ms: 10_000, source: 'measured' }).fraction).toBeNull()
    expect(resolveClipProgress(4_000, { ms: null, source: 'unknown' }).fraction).toBeNull()
  })

  it('clamps to the file: a position past the end reads as the end, never beyond', () => {
    expect(resolveClipProgress(4_000, { ms: 16_000, source: 'measured' }).fraction).toBe(0.25)
    expect(resolveClipProgress(20_000, { ms: 16_000, source: 'index' }).fraction).toBe(1)
    expect(resolveClipProgress(-1, { ms: 16_000, source: 'index' }).fraction).toBe(0)
  })
})

describe('the drag geometry', () => {
  it('maps x on the track to a clamped fraction, and a zero-width track to 0', () => {
    expect(fractionAtX(50, 200)).toBe(0.25)
    expect(fractionAtX(-10, 200)).toBe(0)
    expect(fractionAtX(999, 200)).toBe(1)
    expect(fractionAtX(50, 0)).toBe(0)
  })

  it('commits a whole millisecond inside the file', () => {
    expect(clipOffsetAtFraction(0.25, 16_240)).toBe(4060)
    expect(clipOffsetAtFraction(1.5, 16_240)).toBe(16_240)
    expect(clipOffsetAtFraction(0.5, -1)).toBe(0)
  })
})

describe('routePlayerPosition — which axis a report is on', () => {
  it('with no clip on the frame, every report is an epoch for the machine', () => {
    expect(routePlayerPosition(initialClipStage, 1_700_000_000_000)).toEqual({
      kind: 'session',
      epochMs: 1_700_000_000_000,
    })
  })

  it('with a clip on the frame, a small number is a file-relative position for the clip', () => {
    const stage = clipStageAttach(initialClipStage, CLOSED)
    expect(routePlayerPosition(stage, 12_000)).toEqual({ kind: 'clip', clipId: 'clip-closed', positionMs: 12_000 })
    expect(routePlayerPosition(stage, -3)).toEqual({ kind: 'clip', clipId: 'clip-closed', positionMs: 0 })
  })

  it('with a clip on the frame, an EPOCH is a straggler from the feeder the clip replaced — dropped', () => {
    const stage = clipStageAttach(initialClipStage, GROWING)
    expect(routePlayerPosition(stage, 1_700_000_000_000)).toEqual({
      kind: 'dropped',
      clipId: 'clip-growing',
      reportedMs: 1_700_000_000_000,
    })
    expect(routePlayerPosition(stage, CLIP_POSITION_EPOCH_FLOOR_MS - 1).kind).toBe('clip')
  })

  it('a refused stage holds no clip, so its reports are the session’s', () => {
    const refused = clipStageAttach(initialClipStage, { ...CLOSED, playable: false, unplayableReason: 'no' })
    expect(routePlayerPosition(refused, 5).kind).toBe('session')
  })
})
