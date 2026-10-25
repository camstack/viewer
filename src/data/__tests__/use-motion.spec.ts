import { describe, it, expect } from 'vitest'
import {
  parseMotionEvent,
  parseMotionAnalysis,
  MOTION_CATEGORY,
  motionHoldDeadline,
  isMotionHoldOn,
} from '../use-motion.js'

describe('MOTION_CATEGORY', () => {
  // The subscription filters on the hub's EventCategory BUS value
  // (`EventCategory.MotionOnMotionChanged = 'motion.on-motion-changed'`), NOT
  // the camelCase cap method name. Getting this wrong makes the live event
  // never fire (the bug that made the motion highlight "non parte").
  it('is the hub kebab-case bus value, not the camelCase method name', () => {
    expect(MOTION_CATEGORY).toBe('motion.on-motion-changed')
    expect(MOTION_CATEGORY).not.toBe('motion.onMotionChanged')
  })
})

describe('motion highlight linger (pure logic, injectable clock)', () => {
  const HOLD_MS = 3_000

  it('is ON while motion is active regardless of the deadline', () => {
    // Even a stale/zero deadline can't turn it off while active is true.
    expect(isMotionHoldOn(true, 0, 10_000)).toBe(true)
    expect(isMotionHoldOn(true, 5_000, 10_000)).toBe(true)
  })

  it('lingers for holdMs after motion drops, then clears', () => {
    const dropAt = 10_000
    const deadline = motionHoldDeadline(dropAt, HOLD_MS)
    expect(deadline).toBe(13_000)
    // Immediately after the drop → still on.
    expect(isMotionHoldOn(false, deadline, dropAt)).toBe(true)
    // Partway through the hold → still on.
    expect(isMotionHoldOn(false, deadline, dropAt + 1_500)).toBe(true)
    // Just before the deadline → still on.
    expect(isMotionHoldOn(false, deadline, deadline - 1)).toBe(true)
    // At/after the deadline → off.
    expect(isMotionHoldOn(false, deadline, deadline)).toBe(false)
    expect(isMotionHoldOn(false, deadline, deadline + 1)).toBe(false)
  })

  it('clears immediately when the hold is 0 (no linger)', () => {
    const dropAt = 10_000
    const deadline = motionHoldDeadline(dropAt, 0)
    expect(deadline).toBe(dropAt)
    expect(isMotionHoldOn(false, deadline, dropAt)).toBe(false)
  })

  it('a fresh active signal resets the linger window (later deadline)', () => {
    const firstDeadline = motionHoldDeadline(10_000, HOLD_MS)
    // Motion re-fires at 11_000, then drops again at 12_000 → the new deadline
    // is measured from the LATER drop, extending the highlight.
    const secondDeadline = motionHoldDeadline(12_000, HOLD_MS)
    expect(secondDeadline).toBeGreaterThan(firstDeadline)
    // At 14_000 the first window would be expired, the second still live.
    expect(isMotionHoldOn(false, firstDeadline, 14_000)).toBe(false)
    expect(isMotionHoldOn(false, secondDeadline, 14_000)).toBe(true)
  })

  it('never lingers on a negative hold (clamped to 0)', () => {
    const dropAt = 10_000
    expect(motionHoldDeadline(dropAt, -5_000)).toBe(dropAt)
    expect(isMotionHoldOn(false, motionHoldDeadline(dropAt, -5_000), dropAt)).toBe(false)
  })
})

describe('parseMotionEvent', () => {
  it('parses a well-formed motion.onMotionChanged payload', () => {
    const parsed = parseMotionEvent({
      deviceId: 7,
      detected: true,
      timestamp: 1700000000000,
      source: 'onboard',
    })
    expect(parsed).toEqual({ deviceId: 7, detected: true })
  })

  it('parses a detected=false (motion cleared) payload', () => {
    const parsed = parseMotionEvent({ deviceId: 3, detected: false, timestamp: 1 })
    expect(parsed).toEqual({ deviceId: 3, detected: false })
  })

  it('reads the payload from the live.onEvent ENVELOPE`s `data` (the wire shape)', () => {
    const parsed = parseMotionEvent({
      id: 'e1',
      timestamp: '2026-10-06T16:58:55.888Z',
      source: { type: 'device', id: 102, deviceId: 102 },
      category: 'motion.on-motion-changed',
      data: { deviceId: 102, detected: true, timestamp: 1791305935886, source: 'onboard' },
    })
    expect(parsed).toEqual({ deviceId: 102, detected: true })
  })

  it('returns null for malformed / mistyped payloads', () => {
    expect(parseMotionEvent(null)).toBeNull()
    expect(parseMotionEvent({})).toBeNull()
    expect(parseMotionEvent({ deviceId: '7', detected: true })).toBeNull() // wrong type
    expect(parseMotionEvent({ deviceId: 7 })).toBeNull() // missing detected
    expect(parseMotionEvent({ detected: true })).toBeNull() // missing deviceId
  })
})

/**
 * The motion REGIONS the viewer used to discard.
 *
 * `motion.onMotionChanged` has always carried them (`MotionRegionSchema`:
 * bbox + pixelCount + intensity, and the analysis result documents its raw set
 * as "used for UI debug overlay"), but `parseMotionEvent` kept only `detected`.
 * With nothing to draw, the Overlay panel's motion-regions switch did nothing —
 * which is how it was reported.
 */
describe('parseMotionAnalysis — the regions an overlay can actually draw', () => {
  /**
   * Two mistakes, both mine, both from writing the parser against an assumed
   * schema instead of the real one:
   *
   *   • the wire carries `bbox: { x, y, w, h }` (`BoundingBoxSchema`), not
   *     `{ x1, y1, x2, y2 }` — so EVERY region was rejected and the overlay
   *     drew nothing at all;
   *   • those numbers are PIXELS of the analysis frame, not 0..1 — see
   *     `motion-wasm/zone-gate.ts`, which divides by `frameWidth` for exactly
   *     this reason. Drawn as fractions they would have been meaningless even
   *     if they had parsed.
   *
   * And the event was wrong too: `motion.onMotionChanged` fires only on a
   * transition, so an overlay fed from it freezes on the instant motion began.
   */
  it('normalises pixel bboxes against the frame dimensions', () => {
    const parsed = parseMotionAnalysis({
      source: { deviceId: 9 },
      data: {
        deviceId: 9,
        detected: true,
        frameWidth: 640,
        frameHeight: 360,
        regions: [{ bbox: { x: 64, y: 36, w: 128, h: 72 }, pixelCount: 900, intensity: 12 }],
      },
    })
    expect(parsed?.regions).toEqual([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2, pixelCount: 900, intensity: 12 },
    ])
  })

  it('rejects every region when the frame dimensions are missing', () => {
    // Without them a pixel bbox cannot be placed, and drawing it as a fraction
    // would put a 128px box across a fifth of the picture at random.
    const parsed = parseMotionAnalysis({
      data: { deviceId: 9, detected: true, regions: [{ bbox: { x: 1, y: 1, w: 2, h: 2 } }] },
    })
    expect(parsed?.regions).toEqual([])
  })

  it('drops a degenerate region without dropping the frame', () => {
    const parsed = parseMotionAnalysis({
      data: {
        deviceId: 9,
        detected: true,
        frameWidth: 640,
        frameHeight: 360,
        regions: [
          { bbox: { x: 10, y: 10, w: 0, h: 20 } },
          { bbox: { x: 10, y: 10, w: 20, h: 20 }, pixelCount: 10 },
        ],
      },
    })
    expect(parsed?.detected).toBe(true)
    expect(parsed?.regions).toHaveLength(1)
  })

  it('reads the deviceId from the event SOURCE when the payload omits it', () => {
    const parsed = parseMotionAnalysis({
      source: { deviceId: 101 },
      data: { detected: false, frameWidth: 640, frameHeight: 360, regions: [] },
    })
    expect(parsed?.deviceId).toBe(101)
  })

  it('a malformed event is null, never a throw', () => {
    expect(parseMotionAnalysis(null)).toBeNull()
    expect(parseMotionAnalysis({ data: {} })).toBeNull()
  })
})
