/**
 * @vitest-environment jsdom
 *
 * The truncated serve, kept where the clip is (D623).
 *
 * `clipIncomplete` arrives ONCE, when the stream ends — after the playback it
 * is about. That is the whole difficulty: the operator has had a whole clip's
 * worth of time to press prev/next, to go live, or to drag the bar, and the
 * report lands regardless. So the stage keeps it named by clip, exactly as it
 * keeps the position, the measured length and the audio answer, and it is
 * dropped the moment the operator asks for something else.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Clip } from '../clip-model.js'
import { useClipStage, type ClipStagePorts } from '../use-clip-stage.js'
import type { ClipIncompleteReport } from '../../recording/recording-messages.js'

vi.mock('../use-clip-playback.js', () => ({
  useClipPlayback: () => ({
    state: { kind: 'idle' },
    refuse: () => {},
    close: () => {},
  }),
}))

vi.mock('../use-clip-playback-options.js', () => ({
  useClipPlaybackOptions: () => ({
    presence: 'present',
    controls: { seek: 'forward', stepBack: false, scrub: false, rates: [1] },
  }),
}))

function clip(clipId: string): Clip {
  return {
    clipId,
    deviceId: 102,
    startMs: 1_000,
    endMs: 31_000,
    sourceId: 'native:amcrest:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 102, clipId },
  }
}

const REASON = 'the camera ended this replay early: 4.3 s of 45.0 s arrived, 40.7 s short.'

function short(clipId: string): ClipIncompleteReport {
  return { type: 'clipIncomplete', clipId, code: 'stream-short', reason: REASON }
}

function harness() {
  const ports: ClipStagePorts = {
    playClip: vi.fn(() => true),
    noteAsserted: vi.fn(),
    scrubStart: vi.fn(),
    scrubTo: vi.fn(),
    scrubCommit: vi.fn(),
  }
  const hook = renderHook(() => useClipStage(ports, false))
  act(() => hook.result.current.open(clip('file-1'), 'provider-amcrest'))
  return hook
}

describe('the clip on the stage and the serve that was cut short', () => {
  it('says nothing until the hub has reported', () => {
    expect(harness().result.current.incompleteNotice).toBeNull()
  })

  it('surfaces the hub sentence for the clip it holds', () => {
    const hook = harness()
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    expect(hook.result.current.incompleteNotice).toEqual({ kind: 'stream-short', reason: REASON })
  })

  it('does not let a report about the PREVIOUS file mark the next one', () => {
    const hook = harness()
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    act(() => hook.result.current.open(clip('file-2'), 'provider-amcrest'))
    expect(hook.result.current.incompleteNotice).toBeNull()
    // And a straggler arriving AFTER the move still names the file it was
    // about, so it says nothing about the one now on the stage.
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    expect(hook.result.current.incompleteNotice).toBeNull()
  })

  it('clears when the clip gives the frame back — go-live', () => {
    const hook = harness()
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    act(() => hook.result.current.close())
    expect(hook.result.current.incompleteNotice).toBeNull()
  })

  it('clears when the SAME file is re-opened — a new replay has its own verdict', () => {
    const hook = harness()
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    act(() => hook.result.current.open(clip('file-1'), 'provider-amcrest'))
    expect(hook.result.current.incompleteNotice).toBeNull()
  })

  it('clears on a seek that was DISPATCHED — the operator asked for other footage', () => {
    const hook = harness()
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    act(() => hook.result.current.seek.onSeekBegin())
    act(() => hook.result.current.seek.onSeekCommit(5_000))
    expect(hook.result.current.incompleteNotice).toBeNull()
  })

  it('keeps the sentence on a seek the controls REFUSED — nothing was re-dialled', () => {
    // A backward commit on a forward-only clip never reaches the player
    // (`clip-controls.ts`). Clearing there would erase the report without
    // anything having replaced it, which is the D391 shape: a branch that
    // accepts work, produces nothing, and looks like one that ran.
    const hook = harness()
    act(() => hook.result.current.seek.onSeekBegin())
    act(() => hook.result.current.seek.onSeekCommit(10_000))
    act(() => hook.result.current.reportIncomplete(short('file-1')))
    act(() => hook.result.current.seek.onSeekBegin())
    act(() => hook.result.current.seek.onSeekCommit(2_000))
    expect(hook.result.current.incompleteNotice).toEqual({ kind: 'stream-short', reason: REASON })
  })
})
