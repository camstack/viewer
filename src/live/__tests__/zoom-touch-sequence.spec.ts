import { describe, expect, it } from 'vitest'
import {
  EMPTY_TOUCH_SEQUENCE,
  markPan,
  markPinch,
  SEQUENCE_GAP_MS,
  touchDown,
  touchUp,
} from '../zoom-touch-sequence.js'

describe('touch sequence', () => {
  it('counts the most fingers down at once', () => {
    let s = touchDown(EMPTY_TOUCH_SEQUENCE, 1, 1_000)
    s = touchDown(s, 2, 1_050)
    s = touchUp(s, 1_200)
    expect(s.maxTouches).toBe(2)
  })

  it('keeps a pinch seen through the finger bouncing right after it', () => {
    let s = markPinch(touchDown(EMPTY_TOUCH_SEQUENCE, 2, 1_000), 1_300)
    s = touchUp(s, 1_400)
    // A new single touch inside the gap is the same sequence.
    s = touchDown(s, 1, 1_400 + SEQUENCE_GAP_MS - 1)
    expect(s.pinchSeen).toBe(true)
  })

  it('starts a clean sequence for a single touch after the gap', () => {
    let s = markPan(markPinch(touchDown(EMPTY_TOUCH_SEQUENCE, 2, 1_000), 1_100))
    s = touchUp(s, 1_200)
    s = touchDown(s, 1, 1_200 + SEQUENCE_GAP_MS + 1)
    expect(s).toMatchObject({
      pinchSeen: false,
      panSeen: false,
      maxTouches: 1,
    })
  })

  it('never resets while a second finger lands late in a long touch', () => {
    let s = touchDown(EMPTY_TOUCH_SEQUENCE, 1, 1_000)
    s = markPan(s)
    s = touchDown(s, 2, 9_000)
    expect(s.panSeen).toBe(true)
    expect(s.maxTouches).toBe(2)
  })
})
