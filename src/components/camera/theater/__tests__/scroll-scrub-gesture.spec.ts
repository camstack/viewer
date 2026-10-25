import { describe, it, expect } from 'vitest'
import {
  reduceScrubGesture,
  idleScrubGesture,
  type ScrubGestureState,
  type ScrubGestureCommand,
  type ScrubGestureInput,
} from '../scroll-scrub-gesture.js'

/** Drive a sequence of inputs from idle, collecting every command emitted. */
function run(inputs: readonly ScrubGestureInput[]): {
  state: ScrubGestureState
  commands: ScrubGestureCommand[]
} {
  let state = idleScrubGesture
  const commands: ScrubGestureCommand[] = []
  for (const input of inputs) {
    const r = reduceScrubGesture(state, input)
    state = r.state
    commands.push(...r.commands)
  }
  return { state, commands }
}

describe('reduceScrubGesture (scroll scrub → command mapping)', () => {
  it('the first frame begins the scrub and previews it (begin + move)', () => {
    const { state, commands } = run([{ kind: 'frame', epoch: 1000 }])
    expect(commands).toEqual([{ kind: 'begin' }, { kind: 'move', epoch: 1000 }])
    expect(state).toEqual({ active: true, lastEpoch: 1000 })
  })

  it('later frames only move — begin fires exactly once per gesture', () => {
    const { commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'frame', epoch: 1100 },
      { kind: 'frame', epoch: 1200 },
    ])
    expect(commands.filter((c) => c.kind === 'begin')).toHaveLength(1)
    expect(commands).toEqual([
      { kind: 'begin' },
      { kind: 'move', epoch: 1000 },
      { kind: 'move', epoch: 1100 },
      { kind: 'move', epoch: 1200 },
    ])
  })

  it('NEVER commits mid-drag — no frame produces a commit', () => {
    const { commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'frame', epoch: 1100 },
      { kind: 'frame', epoch: 1200 },
      { kind: 'frame', epoch: 1300 },
    ])
    expect(commands.some((c) => c.kind === 'commit')).toBe(false)
  })

  it('commits EXACTLY ONCE at gesture end, at the final previewed epoch', () => {
    const { state, commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'frame', epoch: 1500 },
      { kind: 'frame', epoch: 2000 },
      { kind: 'end' },
    ])
    const commits = commands.filter((c) => c.kind === 'commit')
    expect(commits).toEqual([{ kind: 'commit', epoch: 2000 }])
    expect(state).toEqual(idleScrubGesture)
  })

  it('a fresh gesture after a commit begins again (re-arm)', () => {
    const { commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'end' },
      { kind: 'frame', epoch: 5000 },
      { kind: 'end' },
    ])
    expect(commands.filter((c) => c.kind === 'begin')).toHaveLength(2)
    expect(commands.filter((c) => c.kind === 'commit')).toEqual([
      { kind: 'commit', epoch: 1000 },
      { kind: 'commit', epoch: 5000 },
    ])
  })

  it('end with no active scrub is a no-op (idempotent — duplicate momentum/idle end)', () => {
    const first = run([{ kind: 'frame', epoch: 1000 }, { kind: 'end' }])
    // A SECOND end (e.g. momentumEnd after an idle-fallback already committed).
    const second = reduceScrubGesture(first.state, { kind: 'end' })
    expect(second.commands).toEqual([])
    expect(second.state).toEqual(idleScrubGesture)
  })

  it('scrolling into the live edge goes live and drops the scrub WITHOUT committing', () => {
    const { state, commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'frame', epoch: 1200 },
      { kind: 'liveEdge', armedSelection: false },
    ])
    expect(commands.some((c) => c.kind === 'commit')).toBe(false)
    expect(commands.filter((c) => c.kind === 'goLive')).toHaveLength(1)
    expect(state).toEqual(idleScrubGesture)
  })

  it('an end right after a liveEdge does not commit (the scrub was already dropped)', () => {
    const { commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'liveEdge', armedSelection: false },
      { kind: 'end' },
    ])
    expect(commands.some((c) => c.kind === 'commit')).toBe(false)
  })

  it('with a selection armed the live edge is a WALL: no goLive, the drag lives on', () => {
    // Dragging the free end FORWARD walks into the live-edge band. Going live
    // there clears the anchor (`GO_LIVE` drops it), so the range the operator
    // was drawing would vanish under the finger reaching for its far end.
    const { state, commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'frame', epoch: 1200 },
      { kind: 'liveEdge', armedSelection: true },
    ])
    expect(commands.some((c) => c.kind === 'goLive')).toBe(false)
    expect(state.active).toBe(true)
    expect(state.lastEpoch).toBe(1200)
  })

  it('the wall does not swallow the release: the end still commits', () => {
    const { commands } = run([
      { kind: 'frame', epoch: 1000 },
      { kind: 'liveEdge', armedSelection: true },
      { kind: 'end' },
    ])
    expect(commands.filter((c) => c.kind === 'commit')).toEqual([{ kind: 'commit', epoch: 1000 }])
  })

  it('liveEdge while idle only goes live (no scrub to drop)', () => {
    const { state, commands } = run([{ kind: 'liveEdge', armedSelection: false }])
    expect(commands).toEqual([{ kind: 'goLive' }])
    expect(state).toEqual(idleScrubGesture)
  })
})
