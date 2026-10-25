/**
 * @vitest-environment jsdom
 *
 * The clip's audio report, kept where the clip is (D621).
 *
 * The broker re-issues `clipAudio` whenever the rate crosses 1×, so this is
 * not a settle the stage can read once: it is a fact that moves under the
 * operator's finger, and it is named by clip precisely because a report that
 * lands after prev/next has moved the stage on would otherwise be drawn over
 * the next file. `useClipStage` already keeps the clip's position and its
 * measured length for the same reason; the audio answer is the third fact of
 * the same shape and it is kept beside them, not in a second store.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Clip } from '../clip-model.js'
import { useClipStage, type ClipStagePorts } from '../use-clip-stage.js'
import type { ClipAudioReport } from '../../recording/recording-messages.js'

vi.mock('../use-clip-playback.js', () => ({
  useClipPlayback: () => ({
    state: { kind: 'idle' },
    refuse: () => {},
    close: () => {},
  }),
}))

vi.mock('../use-clip-playback-options.js', () => ({
  useClipPlaybackOptions: () => ({
    presence: 'absent',
    controls: { seek: 'forward', stepBack: false, scrub: false, rates: [1] },
  }),
}))

function clip(clipId: string): Clip {
  return {
    clipId,
    deviceId: 102,
    startMs: 1_000,
    endMs: 31_000,
    sourceId: 'native:reolink:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 102, clipId },
  }
}

function silentAt(clipId: string, rate: number): ClipAudioReport {
  return { type: 'clipAudio', clipId, carried: false, reason: 'rate', rate }
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
  act(() => hook.result.current.open(clip('file-1'), 'provider-reolink'))
  return hook
}

describe('the clip on the stage and its audio answer', () => {
  it('says nothing until the broker has reported', () => {
    const hook = harness()
    expect(hook.result.current.audioNotice).toBeNull()
  })

  it('surfaces a rate silence for the clip it holds', () => {
    const hook = harness()
    act(() => hook.result.current.reportAudio(silentAt('file-1', 8)))
    expect(hook.result.current.audioNotice).toEqual({ kind: 'silent-by-speed', rate: 8 })
  })

  it('follows the rate back down — the report is re-issued, so the notice clears', () => {
    const hook = harness()
    act(() => hook.result.current.reportAudio(silentAt('file-1', 8)))
    act(() =>
      hook.result.current.reportAudio({
        type: 'clipAudio',
        clipId: 'file-1',
        carried: true,
        codec: 'opus',
      }),
    )
    expect(hook.result.current.audioNotice).toBeNull()
  })

  it('does not let a late report from the PREVIOUS file mark the next one', () => {
    const hook = harness()
    act(() => hook.result.current.reportAudio(silentAt('file-1', 8)))
    act(() => hook.result.current.open(clip('file-2'), 'provider-reolink'))
    expect(hook.result.current.audioNotice).toBeNull()
    // And a straggler arriving after the move still names the file it was
    // about, so it changes nothing about the file now on the stage.
    act(() => hook.result.current.reportAudio(silentAt('file-1', 8)))
    expect(hook.result.current.audioNotice).toBeNull()
  })

  it('says nothing once the clip gives the frame back', () => {
    const hook = harness()
    act(() => hook.result.current.reportAudio(silentAt('file-1', 8)))
    act(() => hook.result.current.close())
    expect(hook.result.current.audioNotice).toBeNull()
  })
})
