/**
 * The wall's BOX, per layout shape, and the portrait column split.
 *
 * Two claims live here, and neither can be made at a mount: `react-native-web`
 * compiles `StyleSheet` entries into class names jsdom cannot interpret, so the
 * height the portrait wall is actually drawn at is not readable from the DOM
 * (the same reason `TIMELINE_CHROME_TEST_ID` exists). What IS readable is the
 * value the screen hands the style — and that value is this module's, computed
 * from window numbers, which is exactly what a pure spec is for.
 *
 * 1. **Every shape states a box, and `stack` states a HEIGHT.** The portrait
 *    stream slot is `{ width: '100%' }` and is sized BY ITS CHILD
 *    (`stream-slot.ts`), so a `flex: 1` wall there is 0pt tall — mounted,
 *    booted, playing, and drawing nothing. That failure is invisible to every
 *    other spec in this directory.
 * 2. **The wall halves the portrait timeline, and takes exactly what it gave
 *    up.** The operator's call, and the arithmetic is asserted as an identity
 *    rather than as two numbers that happen to agree today.
 */
import { describe, expect, it } from 'vitest'

import {
  PORTRAIT_WALL_TIMELINE_FRACTION,
  resolvePortraitColumnSplit,
  wallBoxStyle,
} from '../wall-box.js'

/** An iPhone 15 Pro Max upright, the fixture `viewport-control.ts` uses, with
 *  the status-bar inset the screen pads the column by. */
const PHONE = { columnHeight: 932, topInset: 59, pictureHeight: (430 * 9) / 16 }

function split(wallShowing: boolean) {
  return resolvePortraitColumnSplit({ ...PHONE, wallShowing })
}

describe('the portrait column with ONE camera is exactly what ships', () => {
  it('the picture is its 16:9 box and the timeline is the rest', () => {
    const single = split(false)
    expect(single.streamHeight).toBe(PHONE.pictureHeight)
    expect(single.timelineHeight).toBe(932 - 59 - PHONE.pictureHeight)
  })

  it('the two halves are the whole column, less the inset the screen pads by', () => {
    const single = split(false)
    expect(single.streamHeight + single.timelineHeight).toBe(932 - 59)
  })
})

describe('with a WALL up the timeline gives half its height to the wall', () => {
  it('the timeline is halved', () => {
    const single = split(false)
    const wall = split(true)
    expect(wall.timelineHeight).toBe(single.timelineHeight * PORTRAIT_WALL_TIMELINE_FRACTION)
    expect(wall.timelineHeight).toBe(single.timelineHeight / 2)
  })

  it('and the wall grew by EXACTLY what the timeline gave up', () => {
    // An identity, not two numbers that agree on this fixture: both come from
    // one subtraction, so a change that moved one without the other would have
    // to break this line to compile at all.
    const single = split(false)
    const wall = split(true)
    expect(wall.streamHeight - single.streamHeight).toBe(
      single.timelineHeight - wall.timelineHeight,
    )
  })

  it('the column is still the whole column — nothing is lost between them', () => {
    const wall = split(true)
    expect(wall.streamHeight + wall.timelineHeight).toBe(932 - 59)
  })

  it('the fraction is named once, and it is a half', () => {
    expect(PORTRAIT_WALL_TIMELINE_FRACTION).toBe(0.5)
  })
})

describe('a degenerate column never reaches a style as a NaN', () => {
  it('a first frame with no window yet is zero, not nonsense', () => {
    const s = resolvePortraitColumnSplit({
      columnHeight: 0,
      topInset: 0,
      pictureHeight: 0,
      wallShowing: true,
    })
    expect(s.streamHeight).toBe(0)
    expect(s.timelineHeight).toBe(0)
  })

  it('a picture taller than the column takes the column and leaves nothing over', () => {
    const s = resolvePortraitColumnSplit({
      columnHeight: 200,
      topInset: 20,
      pictureHeight: 900,
      wallShowing: false,
    })
    expect(s.streamHeight).toBe(180)
    expect(s.timelineHeight).toBe(0)
  })
})

describe('every shape states a box, and they are three different boxes', () => {
  const sizes = { wideStreamWidth: 800, portraitStreamHeight: 500 }

  it('`fill` takes the window: the slot is flex, so the wall is too', () => {
    expect(wallBoxStyle({ mode: 'fill', ...sizes })).toEqual({
      width: '100%',
      flex: 1,
      minHeight: 0,
    })
  })

  it('`wide` takes the PICTURE\'s width, so the reel ends where the wall ends', () => {
    expect(wallBoxStyle({ mode: 'wide', ...sizes })).toEqual({
      width: 800,
      flex: 1,
      minHeight: 0,
    })
  })

  it('`stack` states an explicit HEIGHT — a flex child there would be 0pt', () => {
    // The failure this assertion exists for: the portrait stream slot has no
    // flex and no height of its own, so it is sized by this child. A wall with
    // `flex: 1` and nothing else is a booted, playing WebView with no box.
    const box = wallBoxStyle({ mode: 'stack', ...sizes })
    expect(box).toEqual({ width: '100%', height: 500 })
    expect(box.flex).toBeUndefined()
  })

  it('and `stack` draws the height the split resolved, wall or no wall', () => {
    const wall = split(true)
    expect(
      wallBoxStyle({
        mode: 'stack',
        wideStreamWidth: 0,
        portraitStreamHeight: wall.streamHeight,
      }).height,
    ).toBe(wall.streamHeight)
  })
})
