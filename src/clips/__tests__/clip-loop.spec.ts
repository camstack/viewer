/**
 * The loop switch's decision: what happens when the file on the frame ends.
 *
 * Every assertion here is about a DIAL — the loop re-sends the clip to the
 * player, because `clipSeekAllowed` refuses a backward seek on a forward-only
 * source and "back to the start" is the most backward move there is. On a
 * Hikvision or an Amcrest that is one replay session per iteration, and those
 * cameras have ONE replay slot, so the count of dials is the whole point:
 * one per end, never two, and never zero on the second iteration.
 */
import { describe, expect, it } from 'vitest'

import { reduceClipLoop, type ClipLoopMemo } from '../clip-loop.js'

const CLIP = 'row-1'

/** Feed a run of events through the reducer and count the dials. */
function run(
  events: readonly Parameters<typeof reduceClipLoop>[1][],
): { readonly replays: number; readonly memo: ClipLoopMemo } {
  let memo: ClipLoopMemo = null
  let replays = 0
  for (const event of events) {
    const decision = reduceClipLoop(memo, event)
    memo = decision.memo
    if (decision.replay) replays += 1
  }
  return { replays, memo }
}

const ended = (loop: boolean, clipId = CLIP) =>
  ({ kind: 'player', state: 'ended', clipId, loop }) as const
const playing = (loop: boolean, clipId = CLIP) =>
  ({ kind: 'player', state: 'playing', clipId, loop }) as const

describe('reduceClipLoop — the end of a file, answered once', () => {
  it('replays the clip when the player says it ended and the switch is on', () => {
    const decision = reduceClipLoop(null, ended(true))
    expect(decision.replay).toBe(true)
    expect(decision.memo).toBe(CLIP)
  })

  it('does nothing at the end when the switch is off', () => {
    expect(reduceClipLoop(null, ended(false)).replay).toBe(false)
  })

  it('dials ONCE for one end, however many times the player repeats it', () => {
    expect(run([{ kind: 'opened' }, ended(true), ended(true), ended(true)]).replays).toBe(1)
  })

  it('loops again on the NEXT end — the memo is not a one-shot latch', () => {
    // The shape of a real iteration: the dial lands, the file plays, it ends.
    expect(
      run([
        { kind: 'opened' },
        ended(true),
        { kind: 'player', state: 'loading', clipId: CLIP, loop: true },
        playing(true),
        ended(true),
        playing(true),
        ended(true),
      ]).replays,
    ).toBe(3)
  })

  it('an end belonging to the PREVIOUS file cannot suppress the next one', () => {
    // prev/next hands the stage another clip. Its first end must be answered,
    // even though the memo still names the file before it.
    const decision = reduceClipLoop('row-0', ended(true, 'row-1'))
    expect(decision.replay).toBe(true)
    expect(decision.memo).toBe('row-1')
  })

  it('switching the loop OFF at the end keeps the memo — the end stays answered', () => {
    // Otherwise turning the switch off and on again while the player repeats
    // `ended` would dial a second time on one end.
    expect(reduceClipLoop(CLIP, ended(false)).memo).toBe(CLIP)
    expect(run([ended(true), ended(false), ended(true)]).replays).toBe(1)
  })

  it('opening and closing the stage answer nothing and replay nothing', () => {
    for (const event of [{ kind: 'opened' } as const, { kind: 'closed' } as const]) {
      expect(reduceClipLoop(CLIP, event)).toEqual({ memo: null, replay: false })
    }
  })

  it('a state that is not the end never replays, whatever the switch says', () => {
    for (const state of ['loading', 'playing', 'paused', 'gap', 'error', 'live'] as const) {
      expect(
        reduceClipLoop(null, { kind: 'player', state, clipId: CLIP, loop: true }).replay,
        state,
      ).toBe(false)
    }
  })
})
