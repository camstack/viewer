/**
 * @vitest-environment jsdom
 *
 * The loop, where the end of a clip is actually KNOWN.
 *
 * The operator asked for it in the playback bar — *"un pulsante di loop nella
 * playback bar, default true, che riproduce in loop la stessa clip alla
 * fine"* (2026-09-23) — but the bar is presentational, and "the file ended" is
 * a report the player makes. `useClipStage.reportPlayerState` is the one
 * router for those reports while a clip holds the frame, and `replay()` is the
 * one way back to a file's first sample, so the decision is made there and
 * nowhere else. A second detector — a timer comparing `positionMs` against the
 * measured duration — would fire on a duration that is `null` until the broker
 * measures it, and would race the report.
 *
 * What is asserted is the DIAL COUNT. A loop iteration is a fresh
 * `playClip(..., offsetMs: 0)`, not a seek: `clipSeekAllowed` refuses every
 * backward move on a `forward-only` source. On a Hikvision that is one replay
 * session per iteration and the camera has ONE slot, so a duplicate dial makes
 * its scarcest resource contend with itself — the exact waste
 * `use-clip-stage-asserted-once.spec.ts` was written for, which a loop would
 * otherwise repeat forever instead of once per tap.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Clip } from '../clip-model.js'
import { useClipStage, type ClipStagePorts } from '../use-clip-stage.js'

vi.mock('../use-clip-playback.js', () => ({
  useClipPlayback: () => ({
    state: { kind: 'idle' },
    refuse: () => {},
    close: () => {},
  }),
}))

vi.mock('../use-clip-playback-options.js', () => ({
  useClipPlaybackOptions: () => ({ presence: 'absent', controls: { seek: 'forward', stepBack: false, scrub: false, rates: [1] } }),
}))

/** A twin: the FILE id the port is dialled with is not the row's id. */
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

function harness(loop: boolean) {
  const ports: ClipStagePorts = {
    playClip: vi.fn(() => true),
    noteAsserted: vi.fn(),
    scrubStart: vi.fn(),
    scrubTo: vi.fn(),
    scrubCommit: vi.fn(),
  }
  const hook = renderHook(({ on }: { on: boolean }) => useClipStage(ports, on), {
    initialProps: { on: loop },
  })
  act(() => hook.result.current.open(twin(), 'provider-hikvision'))
  const dialsAfterOpen = vi.mocked(ports.playClip).mock.calls.length
  const report = (state: 'ended' | 'playing' | 'loading'): void => {
    act(() => hook.result.current.reportPlayerState(state))
  }
  const loopDials = (): readonly unknown[][] =>
    vi.mocked(ports.playClip).mock.calls.slice(dialsAfterOpen)
  return { ports, hook, report, loopDials }
}

describe('a clip that reaches its end, with the loop ON', () => {
  it('is dialled again from its first sample, by FILE id', () => {
    const { report, loopDials } = harness(true)
    report('ended')
    expect(loopDials()).toEqual([['file-1', 'provider-hikvision', 0, undefined]])
  })

  it('is dialled ONCE however many times the player repeats the end', () => {
    const { report, loopDials } = harness(true)
    report('ended')
    report('ended')
    report('ended')
    expect(loopDials().length).toBe(1)
  })

  it('loops again on the next end — an iteration is not a one-shot', () => {
    const { report, loopDials } = harness(true)
    report('ended')
    report('loading')
    report('playing')
    report('ended')
    expect(loopDials().length).toBe(2)
  })
})

describe('a clip that reaches its end, with the loop OFF', () => {
  it('is not dialled at all', () => {
    const { report, loopDials } = harness(false)
    report('ended')
    expect(loopDials()).toEqual([])
  })

  it('and a clip the stage has let go is not dialled either — the screen was left', () => {
    // Nothing on a timer, so leaving is enough: `close` takes the file off the
    // stage and a straggling `ended` for it can no longer reach the port.
    const { hook, report, loopDials } = harness(true)
    act(() => hook.result.current.close())
    report('ended')
    expect(loopDials()).toEqual([])
  })
})
