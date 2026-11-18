/**
 * @vitest-environment jsdom
 *
 * Play after a failure re-opens the held clip WHERE IT STOOD, on the file's
 * own axis.
 *
 * Found in review, 2026-11-18: the play-recovery path re-entered playback with
 * an absolute epoch (`seek(cursor)`) whatever held the frame. Under a clip the
 * pointer is on a FILE, so that epoch would travel as a file-relative offset
 * hours past its end. The screen now resolves a clip recovery
 * (`resolvePlayRecovery` → `{ kind: 'clip', offsetMs }`) and re-sends the same
 * file through `replay(offsetMs)` — this spec pins that half.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Clip } from '../clip-model.js'
import { useClipStage, type ClipStagePorts } from '../use-clip-stage.js'

vi.mock('../use-clip-playback.js', () => ({
  useClipPlayback: () => ({
    loading: { kind: 'idle' },
    noteOpened: () => {},
    noteState: () => {},
    notePosition: () => {},
  }),
}))

vi.mock('../use-clip-playback-options.js', () => ({
  useClipPlaybackOptions: () => undefined,
}))

function twin(): Clip {
  return {
    clipId: 'row-1',
    deviceId: 1436,
    startMs: 1_000,
    endMs: 31_000,
    sourceId: 'native:hikvision:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 1436, clipId: 'file-1' },
  }
}

function harness() {
  const ports: ClipStagePorts = {
    playClip: vi.fn(() => true),
    noteAsserted: vi.fn(),
    scrubStart: vi.fn(),
    scrubTo: vi.fn(),
    scrubCommit: vi.fn(),
  }
  const hook = renderHook(() => useClipStage(ports))
  act(() => hook.result.current.open(twin(), 'provider-hikvision'))
  return { ports, hook }
}

describe('replay re-sends the dispatched file', () => {
  it('at offset 0 when no position is given (the re-assert)', () => {
    const { ports, hook } = harness()
    act(() => hook.result.current.replay())
    expect(ports.playClip).toHaveBeenLastCalledWith('file-1', 'provider-hikvision', 0, undefined)
  })

  it('at the FILE-relative position it is given (play after a failure)', () => {
    const { ports, hook } = harness()
    act(() => hook.result.current.replay(12_000))
    expect(ports.playClip).toHaveBeenLastCalledWith('file-1', 'provider-hikvision', 12_000, undefined)
  })
})
