/**
 * > *"vorrei che al click su una clip la timeline si centri per mostrarla in
 * > mezzo"* — the operator, 2026-09-23.
 *
 * Every case here asserts WHERE THE CARD ENDS UP, never that a helper was
 * called: `cardMiddleScreenY` re-derives the card's on-screen middle from the
 * offset the rule returned, using the scroller's own layout arithmetic, and
 * compares it to the line it was supposed to land on. An inert substitute for
 * the rule cannot survive that.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  cardCenterLinePx,
  cardCenterScrollOffsetPx,
  holdsTapPlacement,
  type CardCenteringInput,
} from '../timeline-card-centering.js'
import { timelineMaxScrollOffsetPx } from '../timeline-content-height.js'

/** A 393×700 phone at the playback cursor (a half), with the default card. */
const PHONE: CardCenteringInput = {
  cardTopPx: 1_200,
  cardHeightPx: 133,
  indicatorOffsetPx: 350,
  viewportHeightPx: 700,
  cursorDrawn: true,
}

/**
 * The card's middle, in screen pixels from the top of the timeline body, once
 * the list has been scrolled to `offsetPx`.
 *
 * This is `TimelineScroller`'s own arithmetic, spelled out rather than
 * imported: a positioned child's `top` is `cluster.topPx + indicatorOffsetPx`
 * (TimelineScroller.tsx, the cluster loop and the proximity computation), and
 * a scroll offset subtracts from it.
 */
function cardMiddleScreenY(input: CardCenteringInput, offsetPx: number): number {
  return input.cardTopPx + input.cardHeightPx / 2 + input.indicatorOffsetPx - offsetPx
}

function cardTopScreenY(input: CardCenteringInput, offsetPx: number): number {
  return input.cardTopPx + input.indicatorOffsetPx - offsetPx
}

/**
 * The offset, insisting that the rule ANSWERED.
 *
 * `null` is a real answer here (an unmeasured body, asserted in its own case),
 * so every case that goes on to compute a screen position has to narrow it —
 * and a narrowing that throws is what keeps that from becoming a silent `?? 0`
 * that would place a card at the top of the axis and look plausible.
 */
function placed(input: CardCenteringInput): number {
  const offset = cardCenterScrollOffsetPx(input)
  if (offset === null) throw new Error('the rule refused a measured body')
  return offset
}

describe('cardCenterLinePx — what "in mezzo" means on each surface', () => {
  it('is the CURSOR line where a cursor is drawn', () => {
    expect(cardCenterLinePx(PHONE)).toBe(350)
  })

  it('is the VIEWPORT middle where none is', () => {
    // A body of files draws no playhead (`resolveClipsSurface` — `playhead:
    // false`), so there is no line on the glass for a card to sit on and the
    // operator's "in mezzo" can only mean the middle of what he sees.
    expect(cardCenterLinePx({ ...PHONE, cursorDrawn: false })).toBe(350)
    expect(
      cardCenterLinePx({ ...PHONE, cursorDrawn: false, indicatorOffsetPx: 70 }),
    ).toBe(350)
  })

  it('follows the cursor when the cursor moves', () => {
    expect(cardCenterLinePx({ ...PHONE, indicatorOffsetPx: 70 })).toBe(70)
  })
})

describe('cardCenterScrollOffsetPx — the card lands on the line', () => {
  it('puts the card MIDDLE on the cursor, not its bottom edge', () => {
    expect(cardMiddleScreenY(PHONE, placed(PHONE))).toBe(350)
    // And the defect it replaces: seeking the anchor put the card's BOTTOM on
    // the line, i.e. the whole card above it.
    const anchorOffset = PHONE.cardTopPx + PHONE.cardHeightPx
    expect(cardMiddleScreenY(PHONE, anchorOffset)).toBe(350 - PHONE.cardHeightPx / 2)
  })

  it('does not depend on the spacer — it cancels', () => {
    // `contentY(e) = epochToOffset(e) + indicatorOffsetPx` is an additive
    // constant over every positioned child, and the cursor line is drawn at
    // that same constant. So on the cursor surface the answer is the card's
    // own axis offset plus half its height, at any cursor position.
    for (const indicatorOffsetPx of [0, 70, 350, 700]) {
      const input = { ...PHONE, indicatorOffsetPx }
      expect(cardCenterScrollOffsetPx(input)).toBe(PHONE.cardTopPx + PHONE.cardHeightPx / 2)
      expect(cardMiddleScreenY(input, placed(input))).toBe(indicatorOffsetPx)
    }
  })

  it('centres on the VIEWPORT when no cursor is drawn', () => {
    const input: CardCenteringInput = { ...PHONE, cursorDrawn: false, indicatorOffsetPx: 70 }
    expect(cardMiddleScreenY(input, placed(input))).toBe(350)
  })

  it('is the same answer on either axis — it never asks for an epoch', () => {
    // The linear day and the compressed clips axis share no geometry, but a
    // card's `topPx` is already expressed in the axis it belongs to. The rule
    // therefore reads a rectangle and is axis-agnostic by construction; a
    // clips-axis card at 266 px is centred exactly like a linear one there.
    const clips: CardCenteringInput = { ...PHONE, cardTopPx: 266 }
    expect(cardCenterScrollOffsetPx(clips)).toBe(266 + 133 / 2)
  })

  describe('the ends of the axis, where the scroll clamps', () => {
    it('never asks for a negative offset — the newest card sits as high as it can', () => {
      // The newest cluster hangs from the live edge: `topPx = 0 - sizePx`.
      // Its middle is half a card ABOVE offset 0 and the list cannot go there.
      const newest: CardCenteringInput = { ...PHONE, cardTopPx: -133 }
      expect(cardCenterScrollOffsetPx(newest)).toBe(0)
      // It is not centred, and it is not off-screen either: it sits where the
      // top of the axis allows, which is the honest answer.
      expect(cardTopScreenY(newest, 0)).toBe(350 - 133)
    })

    it('the newest clip on a FILE body clamps too, and stays visible', () => {
      // A file body keeps the live cursor's 10 % spacer (nothing seeks, so
      // `isLive` never flips), so there are only 70 px of axis above the first
      // card — it cannot be pushed to a 350 px line.
      const input: CardCenteringInput = {
        ...PHONE,
        cursorDrawn: false,
        indicatorOffsetPx: 70,
        cardTopPx: 0,
      }
      expect(cardCenterScrollOffsetPx(input)).toBe(0)
      expect(cardTopScreenY(input, 0)).toBe(70)
    })

    it('the OLDEST card is reachable: the content extends a viewport past it', () => {
      // `timeline-content-height.ts` guarantees a viewport of trailing room
      // below the last addressable offset, so a centre offset — which is
      // strictly less than the card's bottom, and the bottom is at most the
      // axis span — can never exceed the clamp.
      const dayHeightPx = 4_000
      const oldest: CardCenteringInput = { ...PHONE, cardTopPx: dayHeightPx - 133 }
      const offset = placed(oldest)
      const max = timelineMaxScrollOffsetPx({
        indicatorOffsetPx: oldest.indicatorOffsetPx,
        dayHeightPx,
        contentBottomInsetPx: 0,
        viewportHeightPx: oldest.viewportHeightPx,
      })
      expect(offset).toBeLessThanOrEqual(max)
      expect(cardMiddleScreenY(oldest, offset)).toBe(350)
    })
  })

  describe('a card taller than the body', () => {
    it('is TOP-aligned instead: centring it would hide its beginning', () => {
      // 800 px of card in a 700 px body. Centred on a 70 px live cursor it
      // would hang 330 px above the glass — over half the card, and the half
      // that carries the time label. A card is read from its top, so the top
      // is what is shown.
      const tall: CardCenteringInput = { ...PHONE, cardHeightPx: 800, indicatorOffsetPx: 70 }
      expect(cardTopScreenY(tall, placed(tall))).toBe(0)
    })

    it('top-aligns on the no-cursor surface too, and still clamps at 0', () => {
      const tall: CardCenteringInput = {
        ...PHONE,
        cardHeightPx: 800,
        cardTopPx: 0,
        indicatorOffsetPx: 70,
        cursorDrawn: false,
      }
      expect(cardCenterScrollOffsetPx(tall)).toBe(70)
      expect(cardTopScreenY(tall, 70)).toBe(0)
    })

    it('a card exactly the height of the body is still centred', () => {
      // The boundary is "taller than the body", not "as tall as": at equality
      // the centre and the top-align agree on a half cursor anyway.
      const exact: CardCenteringInput = { ...PHONE, cardHeightPx: 700 }
      expect(cardMiddleScreenY(exact, placed(exact))).toBe(350)
    })
  })

  describe('an unmeasured body', () => {
    it('refuses to move: a 0 px viewport has no middle', () => {
      const unmeasured: CardCenteringInput = {
        ...PHONE,
        viewportHeightPx: 0,
        indicatorOffsetPx: 0,
      }
      expect(cardCenterScrollOffsetPx(unmeasured)).toBeNull()
    })

    it('refuses on a non-finite rectangle rather than scrolling to NaN', () => {
      expect(cardCenterScrollOffsetPx({ ...PHONE, cardTopPx: Number.NaN })).toBeNull()
      expect(cardCenterScrollOffsetPx({ ...PHONE, cardHeightPx: Number.NaN })).toBeNull()
    })
  })
})

describe('holdsTapPlacement — one deliberate move, and nothing afterwards', () => {
  const placement = { fromMs: 1_000, toMs: 5_000 }

  it('holds the placement while the playhead is inside the tapped clip', () => {
    expect(holdsTapPlacement(placement, 1_000)).toBe(true)
    expect(holdsTapPlacement(placement, 3_000)).toBe(true)
    expect(holdsTapPlacement(placement, 5_000)).toBe(true)
  })

  it('releases once playback has run past the clip', () => {
    // The operator did not choose what is on screen any more — the sequencer
    // did — so the follower takes the list back and brings the next clip in.
    expect(holdsTapPlacement(placement, 5_001)).toBe(false)
  })

  it('releases if the seek landed BEFORE the clip, rather than pinning forever', () => {
    expect(holdsTapPlacement(placement, 999)).toBe(false)
  })

  it('holds nothing when nothing was placed', () => {
    expect(holdsTapPlacement(null, 3_000)).toBe(false)
  })

  it('holds nothing without a playhead to judge', () => {
    expect(holdsTapPlacement(placement, null)).toBe(false)
  })
})

/**
 * …and the timeline must actually RUN it.
 *
 * A rule nothing executes is this area's recurring failure — the pure cases
 * above stay green with `TheaterTimeline` unwired, which is exactly how
 * `resolveClipsSurface` came to be computed and read for one field out of
 * five.
 */
describe('TheaterTimeline runs the centring', () => {
  const src = readFileSync(
    new URL('../TheaterTimeline.tsx', import.meta.url).pathname,
    'utf8',
  )
  /**
   * The same file with every comment removed.
   *
   * The wiring assertions below read WINDOWS of source, and this file explains
   * itself at length — a paragraph between two statements pushes the second
   * out of the window, and a paragraph that merely NAMES the rule would satisfy
   * an assertion the code does not. Prose can neither satisfy nor break these.
   */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('asks the rule rather than re-deriving the offset', () => {
    expect(code).toContain('cardCenterScrollOffsetPx({')
  })

  it('centres on the TAP, through the scroller, not through a seek', () => {
    // A file clip deliberately leaves `activeClipId` null and detaches the
    // playback machine (D570). Moving the list must therefore not move the
    // pointer: `scrollListTo` is the programmatic seam, and it marks the
    // scroll as OURS so the resulting `onScroll` is not read as a scrub.
    const at = code.indexOf('const centreTappedCard')
    expect(at).toBeGreaterThan(-1)
    const body = code.slice(at, at + 800)
    expect(body).toContain('cardCenterScrollOffsetPx({')
    expect(body).toContain('scrollListTo(')
    expect(body).not.toContain('onSeek(')
  })

  it('reads the cursor from the ONE authority that decides whether it is drawn', () => {
    // Not `clipsMode`, not `isLive`: the question is whether a mark is DRAWN,
    // and `resolveClipsSurface` is the only thing that answers it (D606).
    expect(code).toContain('const cursorDrawn = clipsSurface.playhead')
    const at = code.indexOf('cardCenterScrollOffsetPx({')
    expect(at).toBeGreaterThan(-1)
    expect(code.slice(at, at + 400)).toContain('cursorDrawn,')
  })

  it('runs on BOTH clip taps — the file one and the seek one', () => {
    const at = code.indexOf('const onClusterTrackSeek')
    expect(at).toBeGreaterThan(-1)
    const handler = code.slice(at, code.indexOf('const openClusterDetail', at))
    // Once before the branch, so neither arm can forget it.
    expect(handler).toContain('centreTappedCard(cluster)')
    expect(handler.match(/centreTappedCard\(/g)?.length).toBe(1)
    const seekArm = handler.indexOf("tap.kind === 'seek'")
    expect(handler.indexOf('centreTappedCard(cluster)')).toBeLessThan(seekArm)
  })

  it('holds the playhead follower off the list while the tapped clip plays', () => {
    // Otherwise the follower re-asserts `epochToOffset(activeEpoch)` — the
    // card's BOTTOM edge — within a frame, and the centring is a bounce.
    const at = code.indexOf("if (mode !== 'playback') return")
    expect(at).toBeGreaterThan(-1)
    const follower = code.slice(at, at + 400)
    expect(follower).toContain('holdsTapPlacement(tapPlacementRef.current, activeEpoch)')
    // …and it must RETURN on the hold, not merely consult it.
    expect(follower).toMatch(/holdsTapPlacement\([^)]*\)\)\s*return/)
    // The seek arm is the one that arms it; the other two clear it, so a
    // placement can never outlive the tap that made it.
    expect(code).toContain('tapPlacementRef.current = { fromMs: clip.startMs, toMs: clip.endMs }')
    expect((code.match(/tapPlacementRef\.current = null/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
})
