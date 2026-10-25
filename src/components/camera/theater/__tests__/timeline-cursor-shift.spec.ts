/**
 * The cursor's move between its two positions, made progressive.
 *
 * > *"non riusciamo a renderlo progressivo? E' abbastanza brutto cosi"* — the
 * > operator, 2026-09-23, on v1.0.542.
 *
 * The RULE is untouched — two states on `isLive`, held through `seeking`. What
 * is tested here is the TRANSITION: its curve, its duration, where it starts
 * when another one interrupts it, and the two changes of cursor offset that
 * are not moves at all.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CURSOR_SHIFT_MS,
  cursorShiftEase,
  cursorShiftScreenPx,
  cursorShiftStartPx,
  shouldAnimateCursorShift,
} from '../timeline-cursor-shift.js'
import {
  indicatorOffsetPx,
  resolveIndicatorPct,
  LIVE_INDICATOR_POSITION_PCT,
  PLAYBACK_INDICATOR_POSITION_PCT,
} from '../timeline-indicator.js'
import { timelineContentHeightPx } from '../timeline-content-height.js'

const VIEWPORT = 700
const LIVE_PX = indicatorOffsetPx(VIEWPORT, LIVE_INDICATOR_POSITION_PCT)
const PLAY_PX = indicatorOffsetPx(VIEWPORT, PLAYBACK_INDICATOR_POSITION_PCT)

function theater(dir: 'out' | 'in'): { from: number; to: number } {
  return dir === 'out' ? { from: LIVE_PX, to: PLAY_PX } : { from: PLAY_PX, to: LIVE_PX }
}

describe('the duration is chosen against the size of the move', () => {
  it('is 220 ms', () => {
    expect(CURSOR_SHIFT_MS).toBe(220)
  })

  it('sits inside the band the move argues for, with margin at both ends', () => {
    // Under ~150 ms the path is not resolved and it reads as the jump it
    // replaces; over ~350 ms the operator is waiting to read a moment he just
    // asked for. Asserted as a band so a future nudge has to argue with the
    // reasoning rather than with a number.
    expect(CURSOR_SHIFT_MS).toBeGreaterThan(150)
    expect(CURSOR_SHIFT_MS).toBeLessThan(350)
  })

  it('and the move it covers really is ~280 px', () => {
    expect(PLAY_PX - LIVE_PX).toBe(280)
  })
})

describe('the curve settles rather than lurching', () => {
  it('is anchored at both ends', () => {
    expect(cursorShiftEase(0)).toBe(0)
    expect(cursorShiftEase(1)).toBe(1)
  })

  it('never goes backwards', () => {
    let last = -1
    for (let i = 0; i <= 100; i++) {
      const v = cursorShiftEase(i / 100)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })

  it('never overshoots — the content must not pass the line and come back', () => {
    for (let i = 0; i <= 100; i++) {
      const v = cursorShiftEase(i / 100)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('is FRONT-loaded: the answer is visibly under way immediately', () => {
    // This fires at the instant the finger leaves the glass. A slow start
    // there reads as the release not having been noticed. Ease-out covers
    // ~70 % in the first third; linear would cover 33 % and ease-in less.
    expect(cursorShiftEase(1 / 3)).toBeGreaterThan(0.6)
    expect(cursorShiftEase(0.5)).toBeGreaterThan(0.8)
  })

  it('and DECELERATES — the last third is a settle, not a stop', () => {
    // A linear slide stops dead, and at 280 px that stop is most of what
    // "brutto" describes. The final third must move far less than the first.
    const firstThird = cursorShiftEase(1 / 3) - cursorShiftEase(0)
    const lastThird = cursorShiftEase(1) - cursorShiftEase(2 / 3)
    expect(lastThird).toBeLessThan(firstThird / 5)
  })

  it('is not linear, and would fail this if somebody replaced it with linear', () => {
    expect(cursorShiftEase(0.5)).not.toBeCloseTo(0.5, 2)
  })

  it('degrades a nonsense progress to a finished animation', () => {
    expect(cursorShiftEase(Number.NaN)).toBe(1)
    expect(cursorShiftEase(-1)).toBe(0)
    expect(cursorShiftEase(2)).toBe(1)
  })
})

describe('a transition starts where nothing appears to move', () => {
  it('leaving live: the content starts 280 px ABOVE its new layout', () => {
    const { from, to } = theater('out')
    expect(cursorShiftStartPx({ currentShiftPx: 0, fromOffsetPx: from, toOffsetPx: to })).toBe(-280)
  })

  it('going live: 280 px BELOW it', () => {
    const { from, to } = theater('in')
    expect(cursorShiftStartPx({ currentShiftPx: 0, fromOffsetPx: from, toOffsetPx: to })).toBe(280)
  })

  it('the frame of the layout jump moves NOTHING on screen', () => {
    // The identity that makes the jump invisible: `to + start === from + 0`.
    for (const dir of ['out', 'in'] as const) {
      const { from, to } = theater(dir)
      const start = cursorShiftStartPx({ currentShiftPx: 0, fromOffsetPx: from, toOffsetPx: to })
      expect(cursorShiftScreenPx(to, start)).toBe(cursorShiftScreenPx(from, 0))
    }
  })
})

describe('an interruption RETARGETS from where the move actually is', () => {
  it('a go-live tapped mid-flight is continuous, not a teleport', () => {
    // Scrub away from live; 150 px of the 280 have been covered when the
    // operator taps go-live. What is on screen must not move in that frame.
    const out = theater('out')
    const inflight = -130 // 150 px of 280 covered
    const onScreenBefore = cursorShiftScreenPx(out.to, inflight)

    const back = theater('in')
    const start = cursorShiftStartPx({
      currentShiftPx: inflight,
      fromOffsetPx: back.from,
      toOffsetPx: back.to,
    })
    expect(cursorShiftScreenPx(back.to, start)).toBe(onScreenBefore)
    // And it is NOT the full delta — that would be the snap, and the snap is
    // a 150 px teleport at a moment the operator caused by pressing something.
    expect(start).not.toBe(280)
    expect(start).toBe(150)
  })

  it('holds across a CHAIN of interruptions of any length', () => {
    // Each start is expressed against the value in force, so continuity is
    // inductive rather than a property of the first two.
    let shift = 0
    let layout = LIVE_PX
    let onScreen = cursorShiftScreenPx(layout, shift)
    // out, back, out, back, out — each caught a different distance in.
    const progress = [0.4, 0.75, 0.1, 0.95]
    for (const [i, p] of progress.entries()) {
      const next = layout === LIVE_PX ? PLAY_PX : LIVE_PX
      const start = cursorShiftStartPx({
        currentShiftPx: shift,
        fromOffsetPx: layout,
        toOffsetPx: next,
      })
      expect(cursorShiftScreenPx(next, start)).toBe(onScreen)
      layout = next
      // The animation runs `p` of the way toward 0 before the next one lands.
      shift = start * (1 - cursorShiftEase(p))
      onScreen = cursorShiftScreenPx(layout, shift)
      expect(i).toBeGreaterThanOrEqual(0)
    }
  })

  it('a move that completes leaves the shift at exactly zero', () => {
    // Anything else and the content is permanently off its layout by a
    // fraction of a pixel that accumulates over a session.
    const { from, to } = theater('out')
    const start = cursorShiftStartPx({ currentShiftPx: 0, fromOffsetPx: from, toOffsetPx: to })
    // `toBeCloseTo`, not `toBe`: the product is −0 and that is the same pixel.
    expect(start * (1 - cursorShiftEase(1))).toBeCloseTo(0, 12)
    expect(cursorShiftScreenPx(to, 0)).toBe(to)
  })

  it('a nonsense current value is treated as settled, never propagated', () => {
    const { from, to } = theater('out')
    expect(
      cursorShiftStartPx({ currentShiftPx: Number.NaN, fromOffsetPx: from, toOffsetPx: to }),
    ).toBe(-280)
    expect(
      cursorShiftStartPx({ currentShiftPx: 0, fromOffsetPx: Number.NaN, toOffsetPx: to }),
    ).toBe(0)
  })
})

describe('two things that look like a cursor move and are not', () => {
  it('the body being MEASURED does not slide the timeline in from above', () => {
    // `viewportHeight` is 0 until the first layout, so the offset goes 0 → 70
    // on every mount.
    expect(
      shouldAnimateCursorShift({ fromOffsetPx: 0, toOffsetPx: 0, viewportHeightPx: 0 }),
    ).toBe(false)
    expect(
      shouldAnimateCursorShift({ fromOffsetPx: 0, toOffsetPx: LIVE_PX, viewportHeightPx: 0 }),
    ).toBe(false)
  })

  it('a rotation moves the OFFSET without moving the percentage', () => {
    // 10 % of 700 is 70; 10 % of 393 is 39. Same cursor, different body. The
    // caller gates on the PERCENTAGE for exactly this reason, and this is the
    // second line of defence.
    expect(indicatorOffsetPx(393, LIVE_INDICATOR_POSITION_PCT)).toBe(39)
    expect(
      shouldAnimateCursorShift({ fromOffsetPx: 70, toOffsetPx: 70, viewportHeightPx: 393 }),
    ).toBe(false)
  })

  it('a real move on a measured body animates', () => {
    expect(
      shouldAnimateCursorShift({
        fromOffsetPx: LIVE_PX,
        toOffsetPx: PLAY_PX,
        viewportHeightPx: VIEWPORT,
      }),
    ).toBe(true)
  })

  it('a non-finite viewport or offset never animates', () => {
    expect(
      shouldAnimateCursorShift({ fromOffsetPx: 0, toOffsetPx: 350, viewportHeightPx: Number.NaN }),
    ).toBe(false)
    expect(
      shouldAnimateCursorShift({
        fromOffsetPx: Number.NaN,
        toOffsetPx: 350,
        viewportHeightPx: VIEWPORT,
      }),
    ).toBe(false)
  })
})

describe('the transition fires ONCE per crossing, finger down or not', () => {
  it('is driven from the percentage, which changes only when the verdict does', () => {
    // The hold through `seeking` is gone (2026-09-23): the operator asked for
    // the move during the scrub, and the epoch under the line is a function of
    // the scroll offset alone, so nothing the readout says moves with it. What
    // still bounds the work is that the effect gates on a CHANGE of the
    // percentage — `atLiveEdge` flips once when the drag passes the 15 s
    // tolerance and then stays put, so a forty-frame drag starts one
    // animation, not forty. This is the source guard on that wiring; the
    // behaviour is `timeline-indicator.spec.ts`.
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx'),
      'utf8',
    )
    expect(src).toContain('if (previous.pct === indicatorPct) return')
    expect(src).toContain('cursorShiftStartPx({')
    expect(src).toContain('duration: CURSOR_SHIFT_MS')
    expect(src).toContain('easing: cursorShiftEase')
    // Interrupt-and-retarget: the value IN FORCE is read back and is what the
    // next move is measured from. A `set(delta)` that ignores it is the snap.
    expect(src).toContain('launch(cursorShiftPx.get())')
  })
})

describe('the move is a TRANSFORM, and the geometry holds throughout it', () => {
  const theaterDir = join(process.cwd(), 'src', 'components', 'camera', 'theater')
  const scroller = readFileSync(join(theaterDir, 'TimelineScroller.tsx'), 'utf8')
  const view = readFileSync(join(theaterDir, 'TimelineView.tsx'), 'utf8')

  it('the scroller carries cursor + zoom shifts on ONE wrapper, as transforms', () => {
    // Cursor move stays translateY; Auto/menu zoom adds scaleY around the
    // playhead. Both are transforms — neither may become a height or a top.
    expect(scroller).toContain('{ translateY: cursorShiftPx ? cursorShiftPx.get() : 0 }')
    expect(scroller).toContain('{ scaleY: zoomScaleY ? zoomScaleY.get() : 1 }')
    expect(scroller).toContain('<Animated.View')
  })

  it('the content container still takes the FINAL height, not a moving one', () => {
    // The whole invariant: a transform changes no frame, so `contentSize` is
    // the same number before, during and after the move — no scroll event, no
    // clamp, and the scrubbed offset survives to the pixel. Animating the
    // spacer's HEIGHT instead would break all three, and would re-lay-out
    // every mounted card per frame.
    expect(scroller).toContain('contentContainerStyle={{ height: contentHeight, position:')
    expect(scroller).not.toMatch(/height:\s*Animated/)
    expect(scroller).not.toMatch(/top:\s*cursorShiftPx/)
  })

  it('and the shift layer adds no layout of its own', () => {
    // Absolute, so its transform cannot reach the measured content height.
    expect(scroller).toContain('shiftLayer: {')
    expect(scroller).toMatch(/shiftLayer:\s*\{\s*position:\s*'absolute'/)
  })

  it('the line and the pill travel with the content, on the SAME value', () => {
    // A cursor line that arrives at the new position ahead of the content it
    // marks spends the whole animation pointing at the wrong moment.
    expect(view).toContain('transform: [{ translateY: shiftPx ? shiftPx.get() : 0 }]')
    expect(view.match(/styles\.indicatorRow, \{ top: indicator\.offsetPx \}, indicatorShift/g))
      .toHaveLength(2)
  })
})

/**
 * The three pieces COMPOSED the way `TheaterTimeline`'s effect composes them:
 * the held percentage decides, the gate filters, the start value is measured
 * against whatever is in force. A bug in this feature lives here — in the
 * composition — rather than in any one of the three.
 */
class CursorMotion {
  private pct = LIVE_INDICATOR_POSITION_PCT
  private layoutPx = LIVE_PX
  private shiftPx = 0
  private progressOfRunning: number | null = null

  constructor(private viewportPx: number = VIEWPORT) {}

  /** Every animation that actually started, with the value it started from. */
  readonly starts: number[] = []

  /** One render, with the timeline's live verdict. */
  frame(atLiveEdge: boolean): void {
    const nextPct = resolveIndicatorPct({ atLiveEdge })
    const fromPx = this.layoutPx
    const toPx = indicatorOffsetPx(this.viewportPx, nextPct)
    const changed = nextPct !== this.pct
    this.pct = nextPct
    this.layoutPx = toPx
    if (!changed) return
    if (!shouldAnimateCursorShift({ fromOffsetPx: fromPx, toOffsetPx: toPx, viewportHeightPx: this.viewportPx })) {
      this.shiftPx = 0
      this.progressOfRunning = null
      return
    }
    // `stopAnimation` — the value IN FORCE, not the one the last animation
    // was aiming at.
    const start = cursorShiftStartPx({
      currentShiftPx: this.shiftPx,
      fromOffsetPx: fromPx,
      toOffsetPx: toPx,
    })
    this.shiftPx = start
    this.progressOfRunning = 0
    this.starts.push(start)
  }

  /** The animation advances by `p` of its remaining duration. */
  advance(p: number): void {
    if (this.progressOfRunning === null) return
    const at = Math.min(1, this.progressOfRunning + p)
    const start = this.starts[this.starts.length - 1] ?? 0
    this.shiftPx = start * (1 - cursorShiftEase(at))
    this.progressOfRunning = at
  }

  /** Where the content actually is on screen right now. */
  onScreenPx(): number {
    return cursorShiftScreenPx(this.layoutPx, this.shiftPx)
  }

  layoutOffsetPx(): number {
    return this.layoutPx
  }
}

describe('the whole gesture, composed', () => {
  it('a hand scrub out of live starts EXACTLY one animation, on the FIRST frame past tolerance', () => {
    const m = new CursorMotion()
    // live → the drag crosses the 15 s tolerance → forty more drag frames,
    // including the momentum tail → the commit. The move now happens at the
    // crossing, which is what the operator asked for; what has not changed is
    // that it happens ONCE. `atLiveEdge` flips there and then stays put, so
    // the other forty frames see no change of percentage and start nothing.
    m.frame(true)
    m.frame(false)
    expect(m.starts).toEqual([-280])
    expect(m.layoutOffsetPx()).toBe(PLAY_PX)
    for (let i = 0; i < 40; i++) m.frame(false)
    expect(m.starts).toEqual([-280])
  })

  it('the heatmap drag and the momentum tail are the same path, so the same one', () => {
    const m = new CursorMotion()
    m.frame(true)
    // heatmap `onScrubBegin('heatmap')` → SCRUB_BEGIN, identical path.
    for (let i = 0; i < 12; i++) m.frame(false)
    m.frame(false)
    // …then native momentum re-enters and settles again.
    for (let i = 0; i < 20; i++) m.frame(false)
    m.frame(false)
    // The second settle is not a second move: the percentage never left 50.
    expect(m.starts).toEqual([-280])
  })

  it('a drag that stays within tolerance never animates at all', () => {
    const m = new CursorMotion()
    m.frame(true)
    for (let i = 0; i < 30; i++) m.frame(true)
    m.frame(true)
    expect(m.starts).toEqual([])
  })

  it('go-live tapped MID-FLIGHT retargets; nothing on screen jumps', () => {
    const m = new CursorMotion()
    m.frame(true)
    m.frame(false)
    m.advance(0.4)
    const before = m.onScreenPx()
    m.frame(true)
    expect(m.onScreenPx()).toBeCloseTo(before, 9)
    expect(m.starts).toHaveLength(2)
    // Not the full 280: that would be the snap, and the snap teleports by
    // however much had already been covered.
    expect(m.starts[1]).not.toBe(280)
    expect(m.starts[1]).toBeGreaterThan(0)
    expect(m.starts[1]).toBeLessThan(280)
  })

  it('and it settles on the live position, not somewhere between', () => {
    const m = new CursorMotion()
    m.frame(true)
    m.frame(false)
    m.advance(0.4)
    m.frame(true)
    m.advance(1)
    expect(m.onScreenPx()).toBeCloseTo(LIVE_PX, 9)
  })

  it('five flips in a row leave no residue', () => {
    const m = new CursorMotion()
    m.frame(true)
    for (const p of [0.2, 0.5, 0.1, 0.8]) {
      m.frame(false)
      m.advance(p)
      m.frame(true)
      m.advance(p)
    }
    m.frame(false)
    m.advance(1)
    expect(m.onScreenPx()).toBeCloseTo(PLAY_PX, 9)
  })

  it('the SCROLL CONTENT HEIGHT is the same number at every frame of every move', () => {
    // The point of carrying the move in a transform. `contentSize` is computed
    // from the LAYOUT offset, which jumps once and is invariant across the two
    // positions anyway; the shift never enters it. A transient height change
    // would emit a scroll event and could clamp a list parked at its end.
    const DAY = 12_000
    const heights = new Set<number>()
    const m = new CursorMotion()
    const record = (): void => {
      heights.add(
        timelineContentHeightPx({
          indicatorOffsetPx: m.layoutOffsetPx(),
          dayHeightPx: DAY,
          contentBottomInsetPx: 72,
          viewportHeightPx: VIEWPORT,
        }),
      )
    }
    m.frame(true)
    record()
    m.frame(false)
    for (let i = 0; i <= 10; i++) {
      m.advance(0.1)
      record()
    }
    m.frame(true)
    for (let i = 0; i <= 10; i++) {
      m.advance(0.1)
      record()
    }
    expect([...heights]).toEqual([DAY + VIEWPORT])
  })
})
