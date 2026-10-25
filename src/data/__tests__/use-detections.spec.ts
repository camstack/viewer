import { describe, it, expect, vi } from 'vitest'
import {
  parseDetectionEvent,
  parseFrameTrackedEvent,
  shouldSuppressRaw,
  DETECTION_FADE_MS,
  type RawSuppressionInput,
} from '../use-detections.js'

describe('parseDetectionEvent', () => {
  it('normalizes pixel bboxes ({x,y,width,height}) by frame dimensions', () => {
    const parsed = parseDetectionEvent({
      source: { type: 'device', id: 7 },
      category: 'detection.result',
      data: {
        frame: {
          width: 1000,
          height: 500,
          detections: [
            { macroClass: 'person', score: 0.9, bbox: { x: 100, y: 50, width: 200, height: 100 } },
          ],
        },
      },
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.sourceId).toBe(7)
    expect(parsed!.boxes).toHaveLength(1)
    const b = parsed!.boxes[0]
    expect(b.label).toBe('person')
    expect(b.x1).toBeCloseTo(0.1, 5)
    expect(b.y1).toBeCloseTo(0.1, 5)
    expect(b.x2).toBeCloseTo(0.3, 5) // (100+200)/1000
    expect(b.y2).toBeCloseTo(0.3, 5) // (50+100)/500
  })

  it('accepts normalized bboxes ({x1,y1,x2,y2}) verbatim', () => {
    const parsed = parseDetectionEvent({
      source: { id: '7' },
      data: {
        frame: {
          width: 0,
          height: 0,
          detections: [
            { label: 'car', score: 0.8, boundingBox: { x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.6 } },
          ],
        },
      },
    })
    expect(parsed).not.toBeNull()
    const b = parsed!.boxes[0]
    expect(b.label).toBe('car')
    expect(b.x1).toBeCloseTo(0.2, 5)
    expect(b.x2).toBeCloseTo(0.5, 5)
  })

  it('drops malformed detections but keeps well-formed ones', () => {
    const parsed = parseDetectionEvent({
      source: { id: 1 },
      data: {
        frame: {
          width: 100,
          height: 100,
          detections: [
            { score: 0.5 }, // no bbox
            'nope',
            { class: 'dog', score: 0.7, bbox: { x: 0, y: 0, width: 10, height: 10 } },
          ],
        },
      },
    })
    expect(parsed!.boxes).toHaveLength(1)
    expect(parsed!.boxes[0].label).toBe('dog')
  })

  it('returns null for non-detection / malformed payloads', () => {
    expect(parseDetectionEvent(null)).toBeNull()
    expect(parseDetectionEvent({})).toBeNull()
    expect(parseDetectionEvent({ source: {} })).toBeNull()
    expect(parseDetectionEvent({ source: { id: 1 }, data: {} })).toBeNull()
    expect(parseDetectionEvent({ source: { id: 1 }, data: { frame: { width: 1, height: 1 } } })).toBeNull()
  })
})

describe('parseFrameTrackedEvent', () => {
  const EVENT = {
    source: { type: 'addon', id: 'pipeline-analytics' },
    data: {
      deviceId: 9,
      timestamp: 1,
      frameWidth: 640,
      frameHeight: 360,
      detections: [
        { id: 'd1', kind: 'first-level', macroClass: 'person', score: 0.9, labels: [{ label: 'Alice', score: 1 }], bbox: { x: 0, y: 0, width: 64, height: 90 } },
        { id: 'detail-t1-face', kind: 'detail', macroClass: 'face', parentId: 'd1', score: 0.8, labels: [{ label: 'Alice', score: 0.8 }], bbox: { x: 16, y: 9, width: 32, height: 36 } },
      ],
    },
  }

  it('parses deviceId, normalized boxes, names and detail flag', () => {
    const parsed = parseFrameTrackedEvent(EVENT)!
    expect(parsed.deviceId).toBe(9)
    expect(parsed.boxes).toHaveLength(2)
    const person = parsed.boxes[0]!
    expect(person.label).toBe('person')
    expect(person.name).toBe('Alice')
    expect(person.detail).toBeUndefined()
    const face = parsed.boxes[1]!
    expect(face.detail).toBe(true)
    expect(face.name).toBe('Alice')
    expect(face.x1).toBeCloseTo(16 / 640)
    expect(face.y2).toBeCloseTo((9 + 36) / 360)
  })

  it('returns null on malformed payloads', () => {
    expect(parseFrameTrackedEvent({ data: { deviceId: 'x' } })).toBeNull()
    expect(parseFrameTrackedEvent(null)).toBeNull()
  })
})

// The `useDetections` hold-window logic (raw `detection.result` deferring to
// a fresh enriched `pipeline-analytics.frame-tracked` frame) is exercised
// here at the pure-helper level rather than via a rendered hook: this repo
// has no hook-render harness (no @testing-library/react or
// react-test-renderer in devDependencies, vitest.config.ts runs
// `environment: 'node'`, and every other srcV2 hook spec — e.g.
// use-motion.spec.ts — tests only its extracted pure functions). The
// suppression decision is extracted into `shouldSuppressRaw` for exactly
// this reason; `useDetections` calls it unmodified
// (`shouldSuppressRaw({...})`), so these cases cover the hook's real runtime
// behavior.

/** Build a suppression input, defaulting the frame stamps to "unknown" (0) so
 *  a case that only cares about the time window reads as one. */
function suppression(over: Partial<RawSuppressionInput> = {}): RawSuppressionInput {
  return {
    lastEnrichedAtMs: 0,
    lastEnrichedFrameMs: 0,
    rawFrameMs: 0,
    nowMs: 0,
    ...over,
  }
}

describe('shouldSuppressRaw (useDetections hold window)', () => {
  it('never suppresses before any enriched frame has been seen (lastEnrichedAt=0, realistic epoch "now")', () => {
    // lastEnrichedAt.current starts at 0 (see useDetections); Date.now() is
    // always a large real-epoch value, so `now - 0` is always >>
    // DETECTION_FADE_MS in practice.
    expect(shouldSuppressRaw(suppression({ nowMs: 999_999 }))).toBe(false)
    expect(shouldSuppressRaw(suppression({ nowMs: Date.now() }))).toBe(false)
  })

  it('suppresses a raw frame arriving immediately after an enriched frame', () => {
    const lastEnrichedAtMs = 10_000
    const rawArrivesAt = lastEnrichedAtMs // same tick — "immediately after"
    expect(shouldSuppressRaw(suppression({ lastEnrichedAtMs, nowMs: rawArrivesAt }))).toBe(true)
  })

  it('keeps suppressing up to (but not including) DETECTION_FADE_MS later', () => {
    const lastEnrichedAtMs = 10_000
    expect(
      shouldSuppressRaw(
        suppression({ lastEnrichedAtMs, nowMs: lastEnrichedAtMs + DETECTION_FADE_MS - 1 }),
      ),
    ).toBe(true)
  })

  it('stops suppressing exactly at DETECTION_FADE_MS — the same instant the enriched display fades', () => {
    // This is the fix under test: the guard window IS DETECTION_FADE_MS, the
    // same constant that arms the fade timer (setTimeout(..., DETECTION_FADE_MS)
    // in useDetections). No separate, longer "hold" constant exists, so raw
    // fallback is accepted at the exact moment the enriched boxes clear —
    // no blank-overlay gap.
    const lastEnrichedAtMs = 10_000
    expect(
      shouldSuppressRaw(
        suppression({ lastEnrichedAtMs, nowMs: lastEnrichedAtMs + DETECTION_FADE_MS }),
      ),
    ).toBe(false)
  })

  it('stops suppressing well past DETECTION_FADE_MS', () => {
    const lastEnrichedAtMs = 10_000
    expect(
      shouldSuppressRaw(
        suppression({ lastEnrichedAtMs, nowMs: lastEnrichedAtMs + DETECTION_FADE_MS + 5_000 }),
      ),
    ).toBe(false)
  })
})

describe('shouldSuppressRaw — a NEWER raw frame is never held back (the ghost/survivor desync)', () => {
  // The hold window alone assumed the enriched plane keeps up. It does not
  // have to: post-analysis re-injects the frame it finished, so while it lags
  // (or stalls entirely, re-emitting nothing new) the window is re-armed by
  // each late arrival and every raw frame inside it is dropped. The survivor
  // boxes then FREEZE on the last enriched frame while the discarded ghosts —
  // which come straight off `detection.result` and never pass this gate —
  // keep moving with the subject. Two layers of the same picture, seconds
  // apart. The frames carry their own capture stamps; compare those.
  it('accepts a raw frame NEWER than the last enriched frame, even deep inside the hold window', () => {
    const enrichedAt = 10_000
    expect(
      shouldSuppressRaw({
        lastEnrichedAtMs: enrichedAt,
        lastEnrichedFrameMs: 5_000, // post-analysis is 2s behind the live plane
        rawFrameMs: 7_000, // this raw frame is newer than what is on screen
        nowMs: enrichedAt + 100, // …and we are 100ms into a 2500ms hold
      }),
    ).toBe(false)
  })

  it('still suppresses a raw frame OLDER than the enriched one inside the window', () => {
    // Out-of-order delivery must not let a stale unenriched frame clobber the
    // names/detail boxes — the reason the hold exists at all.
    const enrichedAt = 10_000
    expect(
      shouldSuppressRaw({
        lastEnrichedAtMs: enrichedAt,
        lastEnrichedFrameMs: 7_000,
        rawFrameMs: 5_000,
        nowMs: enrichedAt + 100,
      }),
    ).toBe(true)
  })

  it('suppresses the SAME frame re-arriving raw (equal stamps are not newer)', () => {
    const enrichedAt = 10_000
    expect(
      shouldSuppressRaw({
        lastEnrichedAtMs: enrichedAt,
        lastEnrichedFrameMs: 7_000,
        rawFrameMs: 7_000,
        nowMs: enrichedAt + 100,
      }),
    ).toBe(true)
  })

  it('falls back to the time window when either side carries no frame stamp', () => {
    // A provider that omits `frame.timestamp` must not accidentally disable
    // the hold — 0 means "unknown", never "epoch, therefore ancient".
    const enrichedAt = 10_000
    expect(
      shouldSuppressRaw({
        lastEnrichedAtMs: enrichedAt,
        lastEnrichedFrameMs: 0,
        rawFrameMs: 9_999_999,
        nowMs: enrichedAt + 100,
      }),
    ).toBe(true)
    expect(
      shouldSuppressRaw({
        lastEnrichedAtMs: enrichedAt,
        lastEnrichedFrameMs: 7_000,
        rawFrameMs: 0,
        nowMs: enrichedAt + 100,
      }),
    ).toBe(true)
  })

  it('a stalled enriched plane still releases the hold on time, newer stamps or not', () => {
    // Belt and braces: the original window is untouched by the stamp rule.
    const enrichedAt = 10_000
    expect(
      shouldSuppressRaw({
        lastEnrichedAtMs: enrichedAt,
        lastEnrichedFrameMs: 7_000,
        rawFrameMs: 5_000,
        nowMs: enrichedAt + DETECTION_FADE_MS,
      }),
    ).toBe(false)
  })
})

describe('the frame stamps the desync fix compares are actually parsed off the wire', () => {
  it('parseDetectionEvent carries `frame.timestamp` (0 when the provider omits it)', () => {
    const parsed = parseDetectionEvent({
      source: { id: 101 },
      data: { frame: { timestamp: 1_700_000_000_123, width: 640, height: 360, detections: [] } },
    })
    expect(parsed?.timestamp).toBe(1_700_000_000_123)
    const noStamp = parseDetectionEvent({
      source: { id: 101 },
      data: { frame: { width: 640, height: 360, detections: [] } },
    })
    expect(noStamp?.timestamp).toBe(0)
  })

  it('parseFrameTrackedEvent carries the enriched frame`s `timestamp`', () => {
    const parsed = parseFrameTrackedEvent({
      data: {
        deviceId: 101,
        timestamp: 1_700_000_000_050,
        frameWidth: 640,
        frameHeight: 360,
        detections: [],
      },
    })
    expect(parsed?.timestamp).toBe(1_700_000_000_050)
  })
})

/** Minimal box shape for the hold-scenario simulation below — only the
 *  fields the assertions inspect. */
interface SimulatedBox {
  readonly label: string
  readonly name?: string
}

describe('useDetections end-to-end hold scenario (simulated via shouldSuppressRaw + fake timers)', () => {
  // Mirrors the hook's actual sequencing: an enriched frame records its
  // receipt time AND its frame stamp and displays its boxes; a raw frame
  // handler calls shouldSuppressRaw with both, plus its own frame stamp,
  // before overwriting state. We simulate the same decisions the hook itself
  // would make, using vi.useFakeTimers() to control Date.now().
  it('enriched frame then an immediate raw frame of the SAME frame: raw is suppressed, enriched boxes remain the effective state', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const lastEnrichedAt = { current: 0 }
      const lastEnrichedFrame = { current: 0 }

      // Enriched frame arrives (source frame stamped 900).
      lastEnrichedAt.current = Date.now()
      lastEnrichedFrame.current = 900
      const enrichedBoxes: SimulatedBox[] = [{ label: 'person', name: 'Alice' }]
      let effectiveBoxes: SimulatedBox[] = enrichedBoxes

      // A raw copy of that same frame arrives on the very next tick.
      vi.advanceTimersByTime(1)
      const rawBoxes: SimulatedBox[] = [{ label: 'person' }] // no name — would clobber if applied
      if (
        !shouldSuppressRaw({
          lastEnrichedAtMs: lastEnrichedAt.current,
          lastEnrichedFrameMs: lastEnrichedFrame.current,
          rawFrameMs: 900,
          nowMs: Date.now(),
        })
      ) {
        effectiveBoxes = rawBoxes
      }

      expect(effectiveBoxes).toBe(enrichedBoxes)
      expect(effectiveBoxes[0]?.name).toBe('Alice')
    } finally {
      vi.useRealTimers()
    }
  })

  it('post-analysis stalls: the live plane keeps producing NEWER frames and the boxes keep moving', () => {
    // The operator-visible bug: with a purely time-based hold, every raw frame
    // in this loop is dropped and the survivor boxes sit still on a subject
    // that is walking across the picture.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const lastEnrichedAt = { current: Date.now() }
      const lastEnrichedFrame = { current: 900 }
      const enrichedBoxes: SimulatedBox[] = [{ label: 'person', name: 'Alice' }]
      let effectiveBoxes: SimulatedBox[] = enrichedBoxes

      // No further enriched frames arrive. Live frames keep coming, each one
      // newer than the enriched one still on screen.
      for (const rawFrameMs of [1_000, 1_200, 1_400]) {
        vi.advanceTimersByTime(200)
        const rawBoxes: SimulatedBox[] = [{ label: 'person' }]
        if (
          !shouldSuppressRaw({
            lastEnrichedAtMs: lastEnrichedAt.current,
            lastEnrichedFrameMs: lastEnrichedFrame.current,
            rawFrameMs,
            nowMs: Date.now(),
          })
        ) {
          effectiveBoxes = rawBoxes
        }
        expect(effectiveBoxes).not.toBe(enrichedBoxes)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('enriched frame then time advances past DETECTION_FADE_MS: display would have cleared, and a raw frame now IS accepted', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const lastEnrichedAt = { current: 0 }

      lastEnrichedAt.current = Date.now()
      const enrichedBoxes: SimulatedBox[] = [{ label: 'person', name: 'Alice' }]
      let effectiveBoxes: SimulatedBox[] = enrichedBoxes

      // The hook's fade timer would clear state at exactly DETECTION_FADE_MS.
      vi.advanceTimersByTime(DETECTION_FADE_MS)
      effectiveBoxes = [] // simulates the fade-timer's setState(EMPTY)

      // A raw frame arriving at this same instant must now be accepted —
      // no gap between the fade and raw fallback resuming.
      const rawBoxes: SimulatedBox[] = [{ label: 'person' }]
      if (
        !shouldSuppressRaw({
          lastEnrichedAtMs: lastEnrichedAt.current,
          lastEnrichedFrameMs: 900,
          rawFrameMs: 800,
          nowMs: Date.now(),
        })
      ) {
        effectiveBoxes = rawBoxes
      }

      expect(effectiveBoxes).toBe(rawBoxes)
      expect(effectiveBoxes[0]?.name).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
