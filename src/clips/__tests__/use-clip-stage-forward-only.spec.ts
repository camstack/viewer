/**
 * @vitest-environment jsdom
 *
 * A backward drag on a FORWARD-ONLY clip is refused HERE, not by the broker.
 *
 * The broker refuses it too and re-sends the position, so without this gate
 * the bar snaps forward under the operator's finger and nothing says why — a
 * control that undoes the gesture reads as broken, where a disabled one reads
 * as unavailable (D62). Until the HUB declares the restriction the clip keeps
 * the freedom it always had: a viewer newer than its hub must not start
 * refusing gestures that worked.
 *
 * What changed with D612: the declaration is per CAMERA and per PROVIDER
 * (`videoclips.getPlaybackOptions`), not per clip. The per-clip `clipTransport`
 * message this hook used to take is gone from the hub and from this app, so
 * the restriction now arrives through `useClipPlaybackOptions` — which is what
 * this spec fakes.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CLIP_PLAYBACK_OPTIONS } from '@camstack/types'

import type { Clip } from '../clip-model.js'
import {
  LEGACY_CONTROLS_VIEW,
  resolveClipControls,
  type ClipControlsView,
} from '../clip-controls.js'
import { useClipStage, type ClipStagePorts } from '../use-clip-stage.js'

// The hook reaches the hub through `useClipPlayback`, which needs a
// ConnectionProvider. Only the SEEK wiring is under test here, so the
// playback half is stubbed rather than a live connection being faked.
vi.mock('../use-clip-playback.js', () => ({
  useClipPlayback: () => ({
    loading: { kind: 'idle' },
    noteOpened: () => {},
    noteState: () => {},
    notePosition: () => {},
  }),
}))

/**
 * What the hub is pretending to say, and — crucially — WHICH pair it was
 * asked about. The hook must ask for the camera and provider of the clip it
 * has on the stage; a spec that ignored the arguments would pass even if the
 * hook asked about nothing at all.
 */
let declared: ClipControlsView = LEGACY_CONTROLS_VIEW
let askedWith: readonly [number | null, string | null] = [null, null]

vi.mock('../use-clip-playback-options.js', () => ({
  useClipPlaybackOptions: (deviceId: number | null, provider: string | null): ClipControlsView => {
    askedWith = [deviceId, provider]
    return deviceId === null || provider === null ? LEGACY_CONTROLS_VIEW : declared
  },
}))

const FORWARD_ONLY = resolveClipControls('present', CLIP_PLAYBACK_OPTIONS.realtimeStream)

beforeEach(() => {
  declared = LEGACY_CONTROLS_VIEW
  askedWith = [null, null]
})

function clip(): Clip {
  return {
    clipId: 'c1',
    deviceId: 107,
    startMs: 1_000,
    endMs: 31_000,
    sourceId: 'native:reolink:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 107, clipId: 'c1' },
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
  act(() => hook.result.current.open(clip(), 'provider-reolink'))
  return { ports, hook }
}

/** Drag from wherever the playhead is to `toMs` and release. */
function drag(hook: ReturnType<typeof harness>['hook'], toMs: number): void {
  act(() => {
    hook.result.current.seek.onSeekBegin()
    hook.result.current.seek.onSeekCommit(toMs)
  })
}

describe('the stage asks about the CAMERA and the PROVIDER it is holding', () => {
  it('names both, from the clip it was opened with', () => {
    harness()
    expect(askedWith).toEqual([107, 'provider-reolink'])
  })

  it('asks about nothing before a clip has ever been opened', () => {
    renderHook(() => useClipStage({
      playClip: vi.fn(() => true),
      noteAsserted: vi.fn(),
      scrubStart: vi.fn(),
      scrubTo: vi.fn(),
      scrubCommit: vi.fn(),
    }))
    expect(askedWith).toEqual([null, null])
  })
})

describe('a forward-only clip refuses a backward seek in the CHROME', () => {
  it('commits a backward drag while the hub has said nothing', () => {
    // The freedom this app always had. Silence is not a restriction.
    const { ports, hook } = harness()
    act(() => void hook.result.current.reportPosition(5_000))
    drag(hook, 1_000)
    expect(ports.scrubCommit).toHaveBeenCalled()
  })

  it('REFUSES a backward drag once the hub declares forward-only', () => {
    declared = FORWARD_ONLY
    const { ports, hook } = harness()
    act(() => hook.result.current.seek.onSeekCommit(9_000)) // move the head forward
    vi.mocked(ports.scrubCommit).mockClear()
    drag(hook, 1_000)
    expect(ports.scrubCommit).not.toHaveBeenCalled()
  })

  it('still commits a FORWARD drag on a forward-only clip', () => {
    // The restriction is a direction, not a disabled control.
    declared = FORWARD_ONLY
    const { ports, hook } = harness()
    drag(hook, 9_000)
    expect(ports.scrubCommit).toHaveBeenCalled()
  })

  it('a PENDING read restricts nothing — not-yet-known is not a refusal (D315)', () => {
    // The SAME restrictive envelope as the test above, resolved on a pending
    // answer instead of a settled one. Everything downstream of
    // `resolveClipControls` reads one already-collapsed value, which is why
    // that collapse lives in exactly one function.
    declared = resolveClipControls('pending', CLIP_PLAYBACK_OPTIONS.realtimeStream)
    const { ports, hook } = harness()
    act(() => hook.result.current.seek.onSeekCommit(9_000))
    vi.mocked(ports.scrubCommit).mockClear()
    drag(hook, 1_000)
    expect(ports.scrubCommit).toHaveBeenCalled()
  })
})
