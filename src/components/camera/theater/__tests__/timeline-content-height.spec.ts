/**
 * Every position the axis can name can be brought to the cursor.
 *
 * > *"il posizionamento del cursore non e' corretto, sembra andare parecchio
 * > sopra alla clip"* — the operator, 2026-09-23, on v1.0.539.
 *
 * The cursor is pinned and the content scrolls under it, so that report is
 * always about the OFFSET. The content was `spacer + dayHeight + footerInset`
 * and a ScrollView clamps at `contentHeight − viewportHeight`, which left the
 * last `viewportHeight − indicatorPx − footerInset` of the axis unreachable —
 * **558 px measured on a 700 px body**. The list stopped short by that much
 * and the card rendered that far below the cursor.
 *
 * These are the numbers from the measurement, not invented ones, and the first
 * describe fails against the old formula.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  timelineContentHeightPx,
  timelineMaxScrollOffsetPx,
  timelineTrailingRoomPx,
  type TimelineContentHeightInput,
} from '../timeline-content-height.js'
import {
  indicatorOffsetPx,
  LIVE_INDICATOR_POSITION_PCT,
  PLAYBACK_INDICATOR_POSITION_PCT,
} from '../timeline-indicator.js'

/** A phone body, the LIVE cursor percentage, a measured footer band. */
const VIEWPORT = 700
const INDICATOR = indicatorOffsetPx(VIEWPORT, LIVE_INDICATOR_POSITION_PCT)
const FOOTER = 72

function geometry(dayHeightPx: number): TimelineContentHeightInput {
  return {
    indicatorOffsetPx: INDICATOR,
    dayHeightPx,
    contentBottomInsetPx: FOOTER,
    viewportHeightPx: VIEWPORT,
  }
}

/** `buildClipAxis`: a leading gap, then n cards each followed by a gap. */
function clipAxisSpanPx(clips: number, sizePx = 96, gapPx = 8): number {
  return gapPx + clips * (sizePx + gapPx)
}

describe('the last addressable offset is reachable', () => {
  it.each([
    ['a short SD-card day', 6],
    ['a medium list', 20],
    ['a long list', 200],
  ])('%s: the OLDEST clip can be scrolled onto the cursor', (_label, clips) => {
    // The axis's furthest offset is its whole span — the oldest card's bottom
    // edge, which is where the follow puts the cursor the instant that clip
    // starts (`clipAxisEpochToOffset`, newest-first).
    const span = clipAxisSpanPx(clips)
    // `dayHeight` is at least one viewport, as the scroller computes it.
    const dayHeight = Math.max(VIEWPORT, span)
    expect(timelineMaxScrollOffsetPx(geometry(dayHeight))).toBeGreaterThanOrEqual(span)
  })

  it('reproduces the 558 px shortfall the OLD formula had', () => {
    // The formula that shipped: spacer + dayHeight + footerInset.
    const span = clipAxisSpanPx(20)
    const dayHeight = Math.max(VIEWPORT, span)
    const oldContentHeight = INDICATOR + dayHeight + FOOTER
    const oldMaxScroll = oldContentHeight - VIEWPORT
    expect(span - oldMaxScroll).toBe(558)
    // And the fix closes exactly that gap, by construction rather than by a
    // number: one viewport below the cursor.
    expect(timelineMaxScrollOffsetPx(geometry(dayHeight)) - oldMaxScroll).toBe(
      VIEWPORT - INDICATOR - FOOTER,
    )
  })

  it('a short axis is reachable too, where the shortfall was nearly the whole list', () => {
    // Six cards is 632 px and the old reachable range was 142 px: only the
    // newest one or two could ever be brought to the cursor.
    const span = clipAxisSpanPx(6)
    expect(span).toBe(632)
    expect(INDICATOR + Math.max(VIEWPORT, span) + FOOTER - VIEWPORT).toBe(142)
    expect(timelineMaxScrollOffsetPx(geometry(Math.max(VIEWPORT, span)))).toBeGreaterThanOrEqual(
      span,
    )
  })
})

describe('the trailing room is DERIVED, not chosen', () => {
  it('is one viewport below the cursor line', () => {
    expect(timelineTrailingRoomPx(geometry(5_000))).toBe(VIEWPORT - INDICATOR)
  })

  it('follows the cursor percentage rather than a constant', () => {
    // Move the cursor and the pad moves with it. A hand-picked number could
    // not do this, and that is the whole point of deriving it.
    // 50 is not decoration: the cursor moved to a half off the live edge
    // (`PLAYBACK_INDICATOR_POSITION_PCT`), so the rule this module fixed has
    // to hold there too. If it did not, the 558 px under-scroll would come
    // back INTERMITTENTLY — only while away from live — which is worse than
    // the constant version it replaced.
    expect(PLAYBACK_INDICATOR_POSITION_PCT).toBe(50)
    for (const pct of [0, 10, 35, 50, 80]) {
      const px = indicatorOffsetPx(VIEWPORT, pct)
      expect(
        timelineTrailingRoomPx({
          indicatorOffsetPx: px,
          dayHeightPx: 5_000,
          contentBottomInsetPx: 0,
          viewportHeightPx: VIEWPORT,
        }),
      ).toBe(VIEWPORT - px)
    }
  })

  it('takes the MAX of the footer reservation, never the sum', () => {
    // They compete for the same room and serve different needs. Summing them
    // would scroll a screenful of nothing past the end of every timeline.
    const room = timelineTrailingRoomPx(geometry(5_000))
    expect(room).toBeLessThan(VIEWPORT - INDICATOR + FOOTER)
    // A footer taller than the pad still wins on its own terms.
    expect(
      timelineTrailingRoomPx({
        indicatorOffsetPx: INDICATOR,
        dayHeightPx: 5_000,
        contentBottomInsetPx: 5_000,
        viewportHeightPx: VIEWPORT,
      }),
    ).toBe(5_000)
  })

  it('degrades to the footer reservation before the body is measured', () => {
    expect(
      timelineTrailingRoomPx({
        indicatorOffsetPx: 0,
        dayHeightPx: 0,
        contentBottomInsetPx: FOOTER,
        viewportHeightPx: 0,
      }),
    ).toBe(FOOTER)
  })
})

describe('the scroller uses the rule', () => {
  it('computes its content height here and not inline', () => {
    // A source guard: the defect was an inline expression, and the fix is only
    // a fix while the scroller actually runs it. Re-inlining would restore the
    // 558 px shortfall with this whole file still green.
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TimelineScroller.tsx'),
      'utf8',
    )
    expect(src).toContain("from './timeline-content-height.js'")
    expect(src).toContain('timelineContentHeightPx({')
    expect(src).not.toMatch(/contentHeight\s*=\s*indicatorOffsetPx\s*\+/)
  })
})

describe('content height is the spacer, the axis and the room', () => {
  it('adds up', () => {
    expect(timelineContentHeightPx(geometry(5_000))).toBe(
      INDICATOR + 5_000 + (VIEWPORT - INDICATOR),
    )
  })
})

describe('the rule holds at BOTH cursor positions', () => {
  /**
   * The cursor became two states on 2026-09-23 (a tenth at the live edge, a
   * half everywhere else). This module's fix is DERIVED from the cursor, and
   * the analysis asserted that total content height is invariant below 90 %
   * so nothing clamps. That claim is checked here rather than trusted: if it
   * were wrong, the 558 px under-scroll would return only while away from
   * live — an intermittent that varies with where the operator is looking.
   */
  const POSITIONS = [
    ['live edge', LIVE_INDICATOR_POSITION_PCT],
    ['playback', PLAYBACK_INDICATOR_POSITION_PCT],
  ] as const

  it.each(POSITIONS)('%s: total content height is the same number', (_label, pct) => {
    // spacer + day + (viewport − spacer) = day + viewport, at every pct where
    // the trailing room beats the footer. So moving the cursor changes WHERE
    // the content is drawn and not HOW MUCH there is.
    for (const dayHeight of [VIEWPORT, 1_000, 5_000, 40_000]) {
      const px = indicatorOffsetPx(VIEWPORT, pct)
      expect(
        timelineContentHeightPx({
          indicatorOffsetPx: px,
          dayHeightPx: dayHeight,
          contentBottomInsetPx: FOOTER,
          viewportHeightPx: VIEWPORT,
        }),
      ).toBe(dayHeight + VIEWPORT)
    }
  })

  it.each(POSITIONS)('%s: the oldest addressable offset is still reachable', (_label, pct) => {
    const px = indicatorOffsetPx(VIEWPORT, pct)
    for (const clips of [6, 20, 200]) {
      const span = clipAxisSpanPx(clips)
      const dayHeight = Math.max(VIEWPORT, span)
      expect(
        timelineMaxScrollOffsetPx({
          indicatorOffsetPx: px,
          dayHeightPx: dayHeight,
          contentBottomInsetPx: FOOTER,
          viewportHeightPx: VIEWPORT,
        }),
      ).toBeGreaterThanOrEqual(span)
    }
  })

  it('the footer never becomes the binding term at either position', () => {
    // The invariance above holds only while `viewport − indicator` beats the
    // footer band. At a half of a 700 px body that is 350 px against ~72 px,
    // and in the landscape drawer (300 px body) 150 px against the same band.
    for (const viewport of [300, 700, 760]) {
      for (const [, pct] of POSITIONS) {
        expect(viewport - indicatorOffsetPx(viewport, pct)).toBeGreaterThan(FOOTER)
      }
    }
  })

  it('and the drawn content moves by exactly the cursor delta, nothing else', () => {
    // The one artefact: keeping the position under a line that moved by Δ
    // moves the content by Δ. 280 px on a 700 px body.
    const live = indicatorOffsetPx(VIEWPORT, LIVE_INDICATOR_POSITION_PCT)
    const playback = indicatorOffsetPx(VIEWPORT, PLAYBACK_INDICATOR_POSITION_PCT)
    expect(playback - live).toBe(280)
  })
})

describe('the retired single-position constant is gone from the tree', () => {
  it('no source still names one fixed cursor percentage', () => {
    // A single-position constant left beside the two-state resolver is a
    // second authority on the same number, and the stale one reads as the
    // current one. A leftover that describes the right design is worse than
    // nothing: it reads as verification.
    // Spelled in two halves so this file is not its own offender.
    const RETIRED = `FIXED_INDICATOR${'_POSITION_PCT'}`
    const roots = ['src', 'embed'].map((d) => join(process.cwd(), d))
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (readFileSync(full, 'utf8').includes(RETIRED)) {
          offenders.push(full)
        }
      }
    }
    for (const root of roots) {
      if (existsSync(root)) walk(root)
    }
    expect(offenders).toEqual([])
  })
})
