/**
 * "se scrollo la lista di Clips va in loading e non ne esce più" — the walk
 * that keeps asking for one more day because the list it emptied put the
 * scroll offset back at the bottom.
 *
 * ## The cycle, exactly
 *
 * On the compressed (clips) axis the "oldest end" is 32 px away
 * (`COMPRESSED_LOOKBACK_THRESHOLD_PX` — the whole visible history is often
 * shorter than one screen, so a viewport-sized threshold was satisfied at
 * every offset). Reaching it asks for one more day. That ask:
 *
 *   1. moves `lookbackDays`, which remints the clip/track query key;
 *   2. the new window has no data, so the body draws NO cards;
 *   3. the content collapses, the ScrollView clamps the offset to the new
 *      (much smaller) maximum and emits a scroll event for the clamp — nobody
 *      is touching the screen;
 *   4. `observeLookbackDays` saw the value MOVE, so it discharged the latch;
 *   5. the clamped event is near the oldest end, the latch is armed, and the
 *      walk asks for another day.
 *
 * Round again, to the 30-day cap, with no further input from the operator —
 * thirty `listClips` / `listTracks` reads over ever-wider windows, the body
 * pinned on "loading" for the whole run. That is what the operator saw.
 *
 * ## Why every assertion here is a COUNT
 *
 * The values are right at every step of that cycle: the window really is
 * wider, the list really is empty, the walk really is near the oldest end.
 * The defect is the NUMBER of asks one gesture produces. A spec that checks
 * what the walk answers cannot see it — the same lesson `clip-publish-loop`
 * paid for on this surface the same day.
 */
import { describe, it, expect } from 'vitest'

import {
  COMPRESSED_LOOKBACK_THRESHOLD_PX,
  armLookbackWalk,
  decideLookbackExtension,
  idleLookbackWalk,
  markLookbackRequested,
  nearOldestEnd,
  observeLookbackDays,
  type LookbackWalkState,
} from '../lookback-walk.js'
import { timelineMaxScrollOffsetPx } from '../timeline-content-height.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOOKBACK_DAYS = 30

/**
 * The clips body and the scrub hook's latch, wired exactly as the two real
 * files wire them — `TheaterTimeline` owns `lookbackDays` and the row count,
 * `use-timeline-scrub` owns the latch and calls it from `onScroll`.
 *
 * The one thing modelled that neither file spells out is the CLAMP: a
 * ScrollView whose content shrinks under a parked offset emits a scroll event
 * at the new maximum. That event is the whole bug, so it is the whole harness.
 */
class ClipsBody {
  readonly viewportPx = 320
  readonly indicatorPx = 32
  readonly rowPx = 120

  private lookbackDays = 1
  private rows: number
  private latch: LookbackWalkState = observeLookbackDays(idleLookbackWalk, 1)

  /** Every extension that actually went out. This is the assertion. */
  extensions = 0
  /** Every scroll event the harness delivered, bug or no bug. */
  scrollEvents = 0

  constructor(rows: number) {
    this.rows = rows
  }

  private contentSpanPx(): number {
    return this.rows * this.rowPx
  }

  /**
   * `use-timeline-scrub.ts` — the furthest the list can be scrolled.
   *
   * It calls the REAL module, not a copy of its arithmetic. The copy that
   * stood here mirrored the pre-fix content formula (`indicatorPx + max(
   * viewport, span) − viewport`), which is the "the fake supplies what
   * production forgot" shape: production could have been changed under it and
   * this harness would have gone on agreeing with the old number.
   */
  maxScrollPx(): number {
    return timelineMaxScrollOffsetPx({
      indicatorOffsetPx: this.indicatorPx,
      dayHeightPx: Math.max(this.viewportPx, this.contentSpanPx()),
      contentBottomInsetPx: 0,
      viewportHeightPx: this.viewportPx,
    })
  }

  /** A finger goes down. */
  beginDrag(): void {
    this.latch = armLookbackWalk(this.latch)
  }

  /** One scroll frame at `offsetY`, exactly as `onScroll` handles it. */
  scroll(offsetY: number): void {
    this.scrollEvents += 1
    // The mirroring effect runs on every render of the owner.
    this.latch = observeLookbackDays(this.latch, this.lookbackDays)
    if (
      !nearOldestEnd({
        offsetY,
        maxScrollPx: this.maxScrollPx(),
        viewportHeightPx: this.viewportPx,
        compressed: true,
      })
    ) {
      return
    }
    if (decideLookbackExtension(this.latch, MAX_LOOKBACK_DAYS) !== 'extend') return
    this.latch = markLookbackRequested(this.latch)
    this.extensions += 1
    this.extend()
  }

  /**
   * What an extension DOES to the body today: the query key changes, the new
   * window has not answered, and `clips.clips` is the module-level empty list.
   * No cards.
   */
  private extend(): void {
    this.lookbackDays = Math.min(MAX_LOOKBACK_DAYS, this.lookbackDays + 1)
    this.rows = 0
  }

  /** The clamp, and the frames of momentum that follow it. */
  settleAfterClamp(frames: number): void {
    for (let i = 0; i < frames; i++) this.scroll(this.maxScrollPx())
  }
}

describe('one flick to the bottom of a clip list asks for ONE more day', () => {
  it('does not walk to the 30-day cap on a gesture the operator made once', () => {
    // 592's onboard list, one screen of it. The operator drags to the bottom
    // and lets go; everything after the first frame is the ScrollView clamping
    // itself against a body that just emptied.
    const body = new ClipsBody(8)
    body.beginDrag()
    body.scroll(body.maxScrollPx())
    body.settleAfterClamp(60)

    expect(body.scrollEvents).toBe(61)
    // ONE. Before the fix this was 30 — the cap, reached with the finger
    // already off the glass, each step a fresh read over a wider window.
    expect(body.extensions).toBe(1)
  })

  it('an untouched surface can never extend at all', () => {
    // The clamp storm with no gesture in front of it: a list that emptied for
    // any other reason (a refetch, a source change) must not start walking.
    const body = new ClipsBody(8)
    body.settleAfterClamp(60)
    expect(body.extensions).toBe(0)
  })

  it('a second flick buys a second day — the walk is armed, not disabled', () => {
    const body = new ClipsBody(8)
    body.beginDrag()
    body.scroll(body.maxScrollPx())
    body.settleAfterClamp(10)
    body.beginDrag()
    body.scroll(body.maxScrollPx())
    body.settleAfterClamp(10)
    expect(body.extensions).toBe(2)
  })

  it('and the threshold really is the compressed one — this is not a geometry accident', () => {
    // If the 32 px threshold were ever widened back to a viewport, the first
    // assertion would still pass for the wrong reason.
    expect(COMPRESSED_LOOKBACK_THRESHOLD_PX).toBe(32)
    expect(
      nearOldestEnd({ offsetY: 0, maxScrollPx: 32, viewportHeightPx: 320, compressed: true }),
    ).toBe(true)
  })
})

describe('there is ONE authority on the maximum scroll offset', () => {
  it('the scrub hook asks the content-height module rather than re-deriving it', () => {
    // `use-timeline-scrub` carried a copy of the PRE-fix content formula for
    // the whole day after the fix landed: `indicatorPx + max(viewport, span)
    // − viewport`, 630 px short of the real maximum at a tenth. It survived
    // because it errs in the harmless direction — it asks for a day earlier
    // than it needs to — and because the harness above mirrored it, so the
    // fake supplied exactly what production had forgotten. With the cursor
    // now at two positions it would also VARY with where the operator is
    // looking, for no reason at all.
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'use-timeline-scrub.ts'),
      'utf8',
    )
    expect(src).toContain("from './timeline-content-height.js'")
    expect(src).toContain('const maxScroll = timelineMaxScrollOffsetPx({')
    // The stale expression itself, in the shape it had.
    expect(src).not.toMatch(/indicatorPxLatest\s*\+\s*Math\.max\(/)
  })
})
