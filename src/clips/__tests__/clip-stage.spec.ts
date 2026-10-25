import { describe, it, expect } from 'vitest'

import {
  clipStageAttach,
  clipStageClose,
  clipStageStep,
  initialClipStage,
  resolveClipLoop,
  stageHoldsClip,
  type ClipStage,
} from '../clip-stage.js'
import type { Clip } from '../clip-model.js'

/**
 * The stage is the FRAME's occupant, and there is exactly one of it.
 *
 * Every assertion here is about the same thing said two ways: while a clip
 * holds the frame, nothing else may be believed to hold it, and when the clip
 * lets go the frame goes back to what it was — not to a default.
 */

function clip(over: Partial<Clip> = {}): Clip {
  return {
    clipId: 'c1',
    deviceId: 107,
    startMs: 1_000,
    endMs: 31_000,
    sourceId: 'native:reolink:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 107, clipId: 'c1' },
    ...over,
  }
}

describe('the stage is one occupant, and a clip taking it is a transition', () => {
  it('starts with the session holding the frame', () => {
    expect(initialClipStage.kind).toBe('session')
    expect(stageHoldsClip(initialClipStage)).toBe(false)
  })

  it('hands the frame to a clip, carrying the loop decision and the cheap profile', () => {
    const stage = clipStageAttach(initialClipStage, clip({ streams: { sub: { id: 'c1', bytes: 712_460 } } }))
    expect(stage.kind).toBe('clip')
    if (stage.kind !== 'clip') throw new Error('unreachable')
    expect(stage.clipId).toBe('c1')
    expect(stage.profile).toBe('low')
    expect(stage.loop).toBe(true)
    expect(stageHoldsClip(stage)).toBe(true)
  })

  it('refuses the frame to a clip the provider called unplayable, and keeps the reason', () => {
    const stage = clipStageAttach(initialClipStage, clip({ playable: false, unplayableReason: 'no-file-for-window' }))
    expect(stage.kind).toBe('refused')
    if (stage.kind !== 'refused') throw new Error('unreachable')
    expect(stage.reason).toBe('no-file-for-window')
    // A refusal is NOT the clip holding the frame: the session keeps the
    // picture and the operator is told why, rather than getting a black box.
    expect(stageHoldsClip(stage)).toBe(false)
  })

  it('gives the frame back to the session on close', () => {
    const open = clipStageAttach(initialClipStage, clip())
    expect(clipStageClose(open)).toBe(initialClipStage)
  })
})

describe('the loop decision, which is a claim about the clip’s END', () => {
  it('loops a closed clip — its endMs is its end', () => {
    expect(resolveClipLoop(clip())).toEqual({ loop: true, reason: 'closed' })
  })

  it('does NOT loop a clip that is still being written', () => {
    // `inProgress` says `endMs` is whatever the camera's index entry happened
    // to hold — on 592 a file reported the same endTime for eight minutes
    // while it went on growing. A loop restarts at an end we do not have.
    expect(resolveClipLoop(clip({ inProgress: true }))).toEqual({ loop: false, reason: 'in-progress' })
  })
})

describe('navigating the clips, which is what a camera with no recording has instead of a playhead', () => {
  const rows: readonly Clip[] = [
    clip({ clipId: 'a', startMs: 3_000, endMs: 4_000 }),
    clip({ clipId: 'b', startMs: 2_000, endMs: 3_000, playable: false, unplayableReason: 'rolled' }),
    clip({ clipId: 'c', startMs: 1_000, endMs: 2_000 }),
  ]

  it('steps to the next clip in the list’s own order', () => {
    expect(clipStageStep(rows, 'a', 1)?.clipId).toBe('c')
  })

  it('steps back the other way', () => {
    expect(clipStageStep(rows, 'c', -1)?.clipId).toBe('a')
  })

  it('SKIPS a clip the provider refused — a step must land on something that plays', () => {
    // 'b' sits between them and cannot be served. Stepping onto it would make
    // "next" a button that produces a refusal, which is the defect this whole
    // line of work is about; the row stays in the LIST with its reason.
    expect(clipStageStep(rows, 'a', 1)?.clipId).toBe('c')
    expect(clipStageStep(rows, 'c', -1)?.clipId).toBe('a')
  })

  it('does not wrap — the ends of the list are ends', () => {
    expect(clipStageStep(rows, 'a', -1)).toBeNull()
    expect(clipStageStep(rows, 'c', 1)).toBeNull()
  })

  it('answers null for a clip that is not in the list at all', () => {
    expect(clipStageStep(rows, 'zzz', 1)).toBeNull()
  })
})

describe('the stage type admits no second authority', () => {
  it('has exactly one arm in which a clip is on screen', () => {
    const kinds: readonly ClipStage['kind'][] = ['session', 'clip', 'refused']
    expect(kinds.filter((k) => k === 'clip')).toHaveLength(1)
  })
})
