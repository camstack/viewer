/**
 * @vitest-environment jsdom
 *
 * The SECOND cycle 1.0.512 shipped, and the one no value-assertion can see.
 *
 * **A loop is not a wrong value. It is the same right value forever.** The
 * eleven red-on-revert proofs written for D570 all check what a function
 * ANSWERS; not one of them can notice that it is asked sixty times a second.
 * So every assertion here is a COUNT.
 *
 * ## The cycle, exactly
 *
 * `useCameraClips` builds its empty list as a fresh `[]` inside a `useMemo`
 * whose deps include the react-query RESULT objects — which change identity on
 * every render. So on a camera whose clip query has not answered (or one on the
 * CamStack source, where `askCap` is false), `clips.clips` is a NEW array every
 * render. `derivedClips` lists it as a dep, so it recomputes; `cameraClips`
 * recomputes; the publish effect fires; the screen sets state; the screen
 * re-renders; the timeline re-renders; around again, at frame rate, forever.
 *
 * React does NOT rescue this. Proving it with a pass-through `adoptClipList`
 * did not raise `Maximum update depth exceeded` — it spun until the runner was
 * killed, which is the failure mode that hung a suite elsewhere in this repo on
 * the same day. So the bound is enforced by the harness (`RENDER_BUDGET`), and
 * this file throws rather than wedging.
 *
 * ## Why this survives whatever shape the clips surface takes
 *
 * The OTHER cycle 1.0.512 shipped (the go-live echo,
 * `go-live-terminator.spec.ts`) is a property of putting the clips surface
 * inside the playback machine, and disappears when it stops being one. This one
 * is not: the list still travels from the timeline's body up to the frame,
 * because the frame steps through it, whatever plays the clip. This is the cost
 * of that trip, paid once.
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { adoptClipList } from '../clip-list-identity.js'
import type { Clip } from '../clip-model.js'

function clip(id: string): Clip {
  return {
    clipId: id,
    deviceId: 3629,
    startMs: 1_789_929_673_000,
    endMs: 1_789_929_688_000,
    sourceId: 'native:reolink:onboard',
    kind: 'native',
    playback: { kind: 'native', deviceId: 3629, clipId: id },
  }
}

interface BodyProps {
  readonly rows: readonly string[]
  readonly onClipsChange: (clips: readonly Clip[]) => void
  readonly onRender: () => void
}

/**
 * How many renders this harness tolerates before it CALLS it a loop.
 *
 * The bound is the test, and it must be enforced by the harness rather than
 * left to React. Proving this loop with a naive `adoptClipList` did not throw
 * `Maximum update depth exceeded` — it spun until the runner was killed, which
 * is the exact failure mode that hung a suite elsewhere in this repo on the
 * same day. A test that hangs reports nothing; this one throws.
 */
const RENDER_BUDGET = 20

/**
 * The timeline's half, reduced to the one thing that matters: it remints the
 * published array on EVERY render, exactly as `derivedClips` does when
 * `clips.clips` is a fresh `[]`.
 */
function Body({ rows, onClipsChange, onRender }: BodyProps): React.ReactElement {
  onRender()
  const cameraClips = rows.map(clip)
  React.useEffect(() => {
    onClipsChange(cameraClips)
  })
  return React.createElement('div')
}

interface FrameProps {
  readonly rows: readonly string[]
  readonly onRender: () => void
}

/** The screen's half: it holds the list so the frame can step through it. */
function Frame({ rows, onRender }: FrameProps): React.ReactElement {
  const [frameClips, setFrameClips] = React.useState<readonly Clip[]>([])
  return React.createElement(
    'div',
    null,
    React.createElement(Body, {
      rows,
      onRender,
      onClipsChange: (next: readonly Clip[]) =>
        setFrameClips((prev) => adoptClipList(prev, next)),
    }),
    React.createElement('span', null, String(frameClips.length)),
  )
}

describe('publishing the clip list up to the frame TERMINATES', () => {
  it('settles in a bounded number of renders on the porta-retro shape (no clips yet)', () => {
    // 3629: a sleeping battery camera. Its clip query had not answered, so the
    // list was rebuilt from scratch on every render.
    let renders = 0
    render(
      React.createElement(Frame, {
        rows: [],
        onRender: () => {
          renders += 1
          if (renders > RENDER_BUDGET) throw new Error(`render loop: ${renders} renders and still going`)
        },
      }),
    )
    expect(renders).toBeLessThanOrEqual(2)
  })

  it('settles just the same once the ten clips have landed', () => {
    let renders = 0
    render(
      React.createElement(Frame, {
        rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
        onRender: () => {
          renders += 1
          if (renders > RENDER_BUDGET) throw new Error(`render loop: ${renders} renders and still going`)
        },
      }),
    )
    expect(renders).toBeLessThanOrEqual(2)
  })
})

describe('adoptClipList — the identity the bail-out depends on', () => {
  it('keeps the PREVIOUS array when the new one says the same thing', () => {
    // Reference equality is the whole mechanism: React bails out of a
    // re-render only when the state value is identical, so returning a
    // content-equal copy would stop nothing.
    const prev = [clip('a'), clip('b')]
    expect(adoptClipList(prev, [clip('a'), clip('b')])).toBe(prev)
  })

  it('keeps it across two empty lists — the case that actually looped', () => {
    const prev: readonly Clip[] = []
    expect(adoptClipList(prev, [])).toBe(prev)
  })

  it('adopts the new one when the list genuinely changed', () => {
    const next = [clip('a'), clip('b')]
    expect(adoptClipList([clip('a')], next)).toBe(next)
  })

  it('adopts when the ORDER changed at the same length', () => {
    // Stepping walks the list's own order, so a reorder is a real change even
    // though nothing was added or removed.
    const next = [clip('b'), clip('a')]
    expect(adoptClipList([clip('a'), clip('b')], next)).toBe(next)
  })

  it('compares ids only — it never walks a clip’s fields', () => {
    // 357 rows on 592, re-checked every time the array identity churns. A deep
    // compare would be the loop's cost paid honestly instead of the loop.
    const prev = [clip('a')]
    expect(adoptClipList(prev, [{ ...clip('a'), thumbnailUrl: '/changed' }])).toBe(prev)
  })
})
