/**
 * The timeline cursor reads the EPOCH axis, and there is no third arm.
 *
 * The defect it was built for: while a native clip held the frame the pill
 * printed `HH:MM:SS` of `activeEpoch` — a moment in our own recording the
 * picture was not at, because no epoch addresses a position inside a file
 * (`clip-progress.ts`, D575). The fix shipped as a clip arm reading the file's
 * own axis, and the operator removed it a day later: over a held file the
 * cursor is not drawn at all.
 *
 * So the property under test is now the ABSENCE. `resolveTimelineCursor` takes
 * one input, it cannot be told about a clip, and neither answer it can give is
 * a file-relative reading.
 */
import { describe, it, expect } from 'vitest'

import { resolveTimelineCursor, LIVE_CURSOR, EPOCH_CURSOR } from '../timeline-cursor.js'

describe('resolveTimelineCursor', () => {
  it('is the live cursor at the live edge', () => {
    expect(resolveTimelineCursor({ isLive: true })).toEqual(LIVE_CURSOR)
  })

  it('is the epoch cursor in our own footage — including a DERIVED clip', () => {
    // A derived clip is played by seeking our recording, so the body's axis IS
    // its axis: the cursor sits over the running card and its wall-clock
    // reading is true. Nothing to relabel, and nothing withdrawn.
    expect(resolveTimelineCursor({ isLive: false })).toEqual(EPOCH_CURSOR)
  })

  it('has no arm that is neither of those two', () => {
    // The union is closed. A `clip` kind coming back would mean the withdrawn
    // cursor has a reading again, which is the thing that was removed.
    for (const isLive of [true, false]) {
      expect(['live', 'epoch']).toContain(resolveTimelineCursor({ isLive }).kind)
    }
  })
})
