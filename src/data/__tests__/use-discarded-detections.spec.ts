import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseDiscardedEvent,
  parseTraceEvent,
  discardReasonKey,
  isRelevantDiscard,
  filterRelevantDiscards,
  RELEVANT_DISCARD_REASONS,
  DISCARDED_CATEGORY,
  PIPELINE_TRACE_CATEGORY,
  type DiscardedBox,
} from '../use-discarded-detections.js'

/** A well-formed `detection.result` envelope carrying a `frame.discarded[]`. */
function detectionEvent(discarded: unknown): unknown {
  return {
    source: { id: 101 },
    data: {
      frame: {
        width: 640,
        height: 360,
        detections: [],
        discarded,
      },
    },
  }
}

describe('parseDiscardedEvent — the frame.discarded[] wire field', () => {
  it('is null when the frame dropped nothing (the server omits the field)', () => {
    // `FrameResult.discarded` is absent, never an empty array, on a frame that
    // dropped nothing. The parser must return null (not an empty frame) so the
    // subscriber ignores the event entirely and a fresh trace pill is not
    // clobbered by every frame that happened to drop nothing.
    expect(parseDiscardedEvent(detectionEvent(undefined))).toBeNull()
    expect(parseDiscardedEvent({ source: { id: 1 }, data: { frame: { width: 1, height: 1, detections: [] } } })).toBeNull()
  })

  it('null on garbage, never a throw', () => {
    expect(parseDiscardedEvent(null)).toBeNull()
    expect(parseDiscardedEvent('nope')).toBeNull()
    expect(parseDiscardedEvent({ data: {} })).toBeNull()
  })

  it('normalizes the executor tuple bbox [x1,y1,x2,y2] (absolute px) against the frame', () => {
    // `DiscardedDetection.bbox` is an `AbsoluteBbox` tuple in SOURCE-FRAME
    // PIXELS — the shape the executor's drop sites emit.
    const parsed = parseDiscardedEvent(
      detectionEvent([{ class: 'vehicle', score: 0.52, bbox: [0, 0, 640, 360], reason: 'full-frame-guard' }]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.sourceId).toBe(101)
    expect(parsed?.boxes).toHaveLength(1)
    expect(parsed?.boxes[0]).toMatchObject({ label: 'vehicle', score: 0.52, x1: 0, y1: 0, x2: 1, y2: 1, reason: 'full-frame-guard' })
  })

  it('normalizes the survivor-style pixel bbox {x,y,width,height}', () => {
    // A provider mirroring `DetectionBoundingBox` (what survivors use on this
    // same event) must land in the same 0..1 space.
    const parsed = parseDiscardedEvent(
      detectionEvent([{ macroClass: 'person', score: 0.4, bbox: { x: 64, y: 36, width: 320, height: 180 }, reason: 'below-threshold' }]),
    )
    expect(parsed?.boxes[0]).toMatchObject({ label: 'person', x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.6 })
  })

  it('skips malformed entries without dropping the frame', () => {
    const parsed = parseDiscardedEvent(
      detectionEvent([
        { class: 'person', score: 'high', bbox: [0, 0, 10, 10] }, // score not a number
        { class: 'person', score: 0.3, bbox: 'nope' }, // bbox garbage
        { class: 'animal', score: 0.3, bbox: [0, 0, 64, 36], reason: 'nms' },
      ]),
    )
    expect(parsed?.boxes).toHaveLength(1)
    expect(parsed?.boxes[0]?.label).toBe('animal')
  })

  it('a missing reason survives as undefined, not a fabricated one', () => {
    const parsed = parseDiscardedEvent(detectionEvent([{ class: 'person', score: 0.3, bbox: [0, 0, 64, 36] }]))
    expect(parsed?.boxes[0]?.reason).toBeUndefined()
  })
})

/** A live `pipeline.trace` envelope (summary verbosity, frame plane). */
function traceEvent(over: Record<string, unknown> = {}): unknown {
  return {
    source: { type: 'device', id: 101 },
    data: {
      traceId: 'trace-1',
      deviceId: 101,
      timestamp: 1000,
      frameSize: { width: 640, height: 360 },
      engineRuntime: 'python+coreml',
      steps: [
        {
          stepId: 'object-detection',
          modelId: 'yolo',
          slot: 'detector',
          postprocessor: 'yolo',
          preprocessMs: 1,
          inferenceMs: 10,
          postprocessMs: 1,
          totalMs: 12,
          inputType: 'full-frame',
          inputSize: { width: 640, height: 360 },
          outputKind: 'detections',
          outputCount: 5,
        },
      ],
      totalMs: 14,
      detectionCount: 2,
      ...over,
    },
  }
}

describe('parseTraceEvent — the count gap that IS reachable today', () => {
  it('reads model-saw from root detector steps and kept from detectionCount', () => {
    const parsed = parseTraceEvent(traceEvent())
    expect(parsed).toMatchObject({ deviceId: 101, modelSaw: 5, kept: 2 })
    expect(parsed?.shedReason).toBeUndefined()
  })

  it('sums outputCount ONLY over full-frame detections steps', () => {
    // A classifier step (`outputKind: 'classifications'`) or a crop-roi detail
    // step is not "what the detector saw on the frame" — counting those would
    // inflate the gap and the pill would lie.
    const parsed = parseTraceEvent(
      traceEvent({
        steps: [
          { inputType: 'full-frame', outputKind: 'detections', outputCount: 3 },
          { inputType: 'full-frame', outputKind: 'classifications', outputCount: 7 },
          { inputType: 'crop-roi', outputKind: 'detections', outputCount: 9 },
        ],
      }),
    )
    expect(parsed?.modelSaw).toBe(3)
  })

  it('surfaces an overload shed annotation', () => {
    const parsed = parseTraceEvent(
      traceEvent({
        steps: [
          {
            inputType: 'full-frame',
            outputKind: 'detections',
            outputCount: 0,
            error: 'shed:worker-in-flight-cap',
          },
        ],
        detectionCount: 0,
      }),
    )
    expect(parsed?.shedReason).toBe('worker-in-flight-cap')
  })

  it('null on garbage or a trace without deviceId', () => {
    expect(parseTraceEvent(null)).toBeNull()
    expect(parseTraceEvent({ data: { steps: [] } })).toBeNull()
  })
})

describe('discardReasonKey — server reason codes map to i18n keys', () => {
  it('maps every known drop site', () => {
    expect(discardReasonKey('below-threshold')).toBe('v2.overlay.reasonThreshold')
    expect(discardReasonKey('confidence')).toBe('v2.overlay.reasonThreshold')
    expect(discardReasonKey('full-frame-guard')).toBe('v2.overlay.reasonFullFrame')
    expect(discardReasonKey('nms')).toBe('v2.overlay.reasonNms')
    expect(discardReasonKey('class-filter')).toBe('v2.overlay.reasonClassFilter')
    expect(discardReasonKey('zone-gate')).toBe('v2.overlay.reasonZoneGate')
  })

  it('an unknown code returns null so the raw code is shown verbatim', () => {
    expect(discardReasonKey('some-new-gate')).toBeNull()
  })
})

/** A parsed box, defaulting to a shape the filter would otherwise accept, so
 *  each case varies only the `reason` under test. */
function box(reason: string | undefined, over: Partial<DiscardedBox> = {}): DiscardedBox {
  const base: DiscardedBox = {
    label: 'person',
    score: 0.3,
    x1: 0.1,
    y1: 0.1,
    x2: 0.2,
    y2: 0.2,
    ...(reason !== undefined ? { reason } : {}),
  }
  return { ...base, ...over }
}

describe('isRelevantDiscard — the middle ground the "all" rung draws', () => {
  it('draws a below-threshold near-miss: a real subject that just missed the bar', () => {
    expect(isRelevantDiscard(box('below-threshold'))).toBe(true)
  })

  it('draws a zone-gate box: the right subject, standing outside the zone', () => {
    expect(isRelevantDiscard(box('zone-gate'))).toBe(true)
  })

  it('drops class-filter ghosts — the chairs and TVs the operator did not enable', () => {
    // `class-filter` is the code for BOTH "macro not in enabledMacroClasses"
    // and "COCO class the classMap does not map". Neither is a subject the
    // operator asked to see; drawing them is what made the rung unusable.
    expect(isRelevantDiscard(box('class-filter', { label: 'chair' }))).toBe(false)
  })

  it('drops full-frame-guard phantoms', () => {
    expect(isRelevantDiscard(box('full-frame-guard', { x1: 0, y1: 0, x2: 1, y2: 1 }))).toBe(false)
  })

  it("treats 'confidence' as the same near-miss fact discardReasonKey already does", () => {
    // The two codes share one label key; they must share one draw decision, or
    // a box labelled "below threshold" would be silently withheld.
    expect(discardReasonKey('confidence')).toBe(discardReasonKey('below-threshold'))
    expect(isRelevantDiscard(box('confidence'))).toBe(true)
  })

  it('drops a box with no reason — the server always sets one, so relevance is unprovable', () => {
    expect(isRelevantDiscard(box(undefined))).toBe(false)
  })

  it('drops an unknown future code rather than guessing it is relevant', () => {
    expect(isRelevantDiscard(box('some-new-gate'))).toBe(false)
  })

  it('the relevant set is exactly the near-miss and out-of-zone codes', () => {
    expect([...RELEVANT_DISCARD_REASONS].sort()).toEqual([
      'below-threshold',
      'confidence',
      'zone-gate',
    ])
  })
})

describe('filterRelevantDiscards — what the overlay draws vs what the pill counts', () => {
  it('keeps only the relevant boxes, in the order the frame delivered them', () => {
    const frame: readonly DiscardedBox[] = [
      box('class-filter', { label: 'chair' }),
      box('below-threshold', { label: 'person' }),
      box('full-frame-guard', { label: 'vehicle' }),
      box('zone-gate', { label: 'animal' }),
    ]
    expect(filterRelevantDiscards(frame).map((b) => b.label)).toEqual(['person', 'animal'])
  })

  it('never mutates the input — the pill still counts the UNFILTERED set', () => {
    const frame: readonly DiscardedBox[] = [box('class-filter'), box('zone-gate')]
    const drawn = filterRelevantDiscards(frame)
    expect(frame).toHaveLength(2)
    expect(drawn).toHaveLength(1)
    expect(frame).not.toBe(drawn)
  })

  it('an all-irrelevant frame draws nothing', () => {
    expect(filterRelevantDiscards([box('class-filter'), box('full-frame-guard')])).toHaveLength(0)
  })
})

describe('wiring — a diagnostic mode nobody mounts is a dead switch', () => {
  const root = process.cwd()

  it('the categories are the live wire names', () => {
    expect(DISCARDED_CATEGORY).toBe('detection.result')
    expect(PIPELINE_TRACE_CATEGORY).toBe('pipeline.trace')
  })

  it("the overlay panel offers the 'discarded' layer that reaches this feed", () => {
    // There is no separate diagnostic switch any more: the discarded ghosts are
    // one chip of the box overlay's layer set. If the panel stops offering it,
    // this feed becomes unreachable — which is exactly what a buried
    // "(diagnostic)" toggle defaulting off amounted to in practice. It is now
    // its OWN chip, so asking for the ghosts no longer forces the survivors on
    // as the old top rung did.
    const layers = readFileSync(
      join(root, 'src', 'components', 'camera', 'overlay', 'overlay-config.ts'),
      'utf8',
    )
    expect(layers).toContain("discarded: 'v2.overlay.layerDiscarded'")
    const panel = readFileSync(
      join(root, 'src', 'components', 'camera', 'theater', 'TimelineOverlayPanel.tsx'),
      'utf8',
    )
    expect(panel).toContain('<OverlayLayersRow')
    expect(panel).toContain('visibleLayers(context)')
  })

  it("the screen mounts the DiscardedBoxesOverlay behind the 'discarded' layer", () => {
    // The overlay-config guard asserts every layer is READ by the screen; this
    // asserts the read actually mounts the drawing component.
    const screen = readFileSync(join(root, 'src', 'screens', 'CameraDetailScreen.tsx'), 'utf8')
    expect(screen).toContain('DiscardedBoxesOverlay')
    expect(screen).toContain("hasLayer(overlay, 'discarded')")
  })

  it('the overlay DRAWS the filtered set and COUNTS the unfiltered one', () => {
    // The pill is the diagnostic (it must keep reporting the whole gap); the
    // boxes are the UX. Drawing straight from `boxes` is the regression this
    // guards — it is what put chairs and full-frame phantoms on the picture.
    const overlay = readFileSync(
      join(root, 'src', 'components', 'camera', 'DiscardedBoxesOverlay.tsx'),
      'utf8',
    )
    expect(overlay).toContain('filterRelevantDiscards')
    expect(overlay).toContain('drawnBoxes.map(')
    expect(overlay).not.toContain('boxes.map(')
    // `model N · kept M` still comes from the trace, untouched by the filter.
    expect(overlay).toContain('saw: trace.modelSaw, kept: trace.kept')
  })

  it("the discarded layer's hint promises the near-miss / out-of-zone set, in both languages", () => {
    // Copy that still promises "every box the pipeline dropped" would be a lie
    // the moment the filter landed.
    for (const lang of ['en', 'it']) {
      const raw = readFileSync(join(root, 'locales', `${lang}.json`), 'utf8')
      const hint = raw.split('\n').find((line) => line.includes('"layerDiscardedHint"'))
      expect(hint).toBeDefined()
      expect(hint).not.toContain('full-frame')
      expect(hint).not.toContain(lang === 'en' ? 'class filter' : 'filtro classe')
      expect(hint).toContain(lang === 'en' ? 'zone' : 'zona')
    }
  })
})
