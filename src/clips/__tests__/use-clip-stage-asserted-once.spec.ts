/**
 * @vitest-environment jsdom
 *
 * A clip is sent to the player ONCE per tap.
 *
 * ## The waste this closes, measured
 *
 * From the operator's session of 2026-09-23, one tap on a Hikvision clip:
 *
 * ```
 * 764311  open: stage · open: dispatch · open: port · open: inject
 * 764336  open: assert (playerState playing) · open: port · open: inject
 * 764358  playClip arrived ×2 · playClip sent to the broker ×2
 * ```
 *
 * Two injections, ~25 ms apart, for one tap. The provider answered both and
 * the loser shows up as a refusal it logs itself — `a replay was refused, the
 * camera's slot is held`, `holder: "stream"`, `waitedMs: 3000`. A Hikvision
 * has ONE replay slot, so the duplicate does not merely cost a dial: it makes
 * the camera's scarcest resource contend with itself.
 *
 * ## Why it happened, and why it is not a bug in the re-assertion
 *
 * `clip-assert-on-player.ts` is idempotent BY DESIGN — it refuses when this
 * clip has already been asserted to this player. But its record had one
 * writer and two senders: the re-assert effect wrote it, and the TAP, which
 * sends through the same port, did not. So the second sender always found the
 * record empty and always fired.
 *
 * The record can only be written in STAGE ids (`clipHoldingFrame`), and the
 * port speaks FILE ids — which differ for a twin. Only the hook holds both.
 * Hence the split asserted here: the port answers whether the command reached
 * a player that could hear it, and the hook — the one place that knows which
 * stage clip a file id belongs to — reports it.
 *
 * The recovery is untouched and MUST stay so: when the command did NOT land
 * (no player yet, or one still connecting) nothing is reported, so the effect
 * still re-asserts when the player arrives. That is the failure of
 * 2026-09-22, which took six attempts over three days to close.
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

/**
 * A row whose FILE id is not its stage id — the twin the port's vocabulary
 * cannot express. A spec written with the two equal would pass against a fix
 * that reported the wrong one.
 */
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

function harness(landed: boolean) {
  const asserted: string[] = []
  const ports: ClipStagePorts = {
    playClip: vi.fn(() => landed),
    noteAsserted: vi.fn((stageClipId: string) => {
      asserted.push(stageClipId)
    }),
    scrubStart: vi.fn(),
    scrubTo: vi.fn(),
    scrubCommit: vi.fn(),
  }
  const hook = renderHook(() => useClipStage(ports))
  act(() => hook.result.current.open(twin(), 'provider-hikvision'))
  return { ports, hook, asserted }
}

describe('a tap that REACHES the player is recorded, so nothing re-sends it', () => {
  it('reports the STAGE id, not the file id the port was given', () => {
    const { ports, asserted } = harness(true)
    // What the port was told to play: the FILE.
    expect(ports.playClip).toHaveBeenCalledWith('file-1', 'provider-hikvision', 0, undefined)
    // What the screen's record is keyed on: the STAGE clip. Reporting
    // 'file-1' here would never match `clipHoldingFrame` and the re-assert
    // would fire anyway — the duplicate, with a fix in front of it.
    expect(asserted).toEqual(['row-1'])
  })

  it('reports exactly once for one tap', () => {
    const { ports, asserted } = harness(true)
    expect(ports.playClip).toHaveBeenCalledTimes(1)
    expect(asserted).toHaveLength(1)
  })
})

describe('a tap that reaches NOBODY is not recorded — the recovery survives', () => {
  it('says nothing when the command was carried into the mount instead', () => {
    // `playClip` answering false is the port's way of saying "there was no
    // player, I set `initialClip` instead". Recording that as asserted is how
    // the 2026-09-22 failure would come back: the effect would decide the
    // clip was already playing and the operator would get the live edge.
    const { ports, asserted } = harness(false)
    expect(ports.playClip).toHaveBeenCalledTimes(1)
    expect(ports.noteAsserted).not.toHaveBeenCalled()
    expect(asserted).toEqual([])
  })
})
