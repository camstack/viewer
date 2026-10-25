import { describe, expect, it } from 'vitest'
import {
  beginZoomTrace,
  formatZoomTrace,
  newZoomTraceBuffer,
  pushZoomSample,
  takeZoomTrace,
  ZOOM_TRACE_CAP,
  ZOOM_TRACE_UPDATE_MIN_MS,
  type ZoomTraceSample,
} from '../zoom-trace.js'

/**
 * The operator can only say how the zoom FEELS. The trace is what turns one
 * pinch into numbers a developer can read without the code open: live vs
 * committed scale, the pan before and after the clamp and the limit it hit,
 * the box the geometry used and the box actually drawn, the instant of the
 * release. It accumulates on the UI thread — no JS hop per frame — and is
 * rendered once, at the end.
 */
const at = (t: number, phase: ZoomTraceSample['phase'], extra: Partial<ZoomTraceSample> = {}): ZoomTraceSample => ({
  t,
  phase,
  live: 1,
  committed: 1,
  x: 0,
  y: 0,
  boxW: 430,
  boxH: 242,
  ...extra,
})

describe('zoom trace buffer', () => {
  it('throttles update samples but never the phase changes', () => {
    const buf = newZoomTraceBuffer()
    beginZoomTrace(buf, 1000)
    pushZoomSample(buf, at(0, 'start'))
    pushZoomSample(buf, at(5, 'update'))
    pushZoomSample(buf, at(10, 'update'))
    pushZoomSample(buf, at(ZOOM_TRACE_UPDATE_MIN_MS + 5, 'update'))
    pushZoomSample(buf, at(ZOOM_TRACE_UPDATE_MIN_MS + 8, 'end'))
    const phases = takeZoomTrace(buf).map((s) => `${s.phase}@${s.t}`)
    expect(phases).toEqual(['start@0', 'update@5', `update@${ZOOM_TRACE_UPDATE_MIN_MS + 5}`, `end@${ZOOM_TRACE_UPDATE_MIN_MS + 8}`])
  })

  it('is bounded — a gesture that never ends cannot grow the UI thread', () => {
    const buf = newZoomTraceBuffer()
    beginZoomTrace(buf, 0)
    for (let i = 0; i < ZOOM_TRACE_CAP * 3; i++) pushZoomSample(buf, at(i * 1000, 'box'))
    expect(takeZoomTrace(buf)).toHaveLength(ZOOM_TRACE_CAP)
  })

  it('take empties the buffer, so every sample is reported exactly once', () => {
    const buf = newZoomTraceBuffer()
    beginZoomTrace(buf, 0)
    pushZoomSample(buf, at(0, 'start'))
    expect(takeZoomTrace(buf)).toHaveLength(1)
    expect(takeZoomTrace(buf)).toHaveLength(0)
  })
})

describe('formatZoomTrace', () => {
  it('renders one line per sample that reads without the code: phase, scales, pan raw → clamped, limit, box', () => {
    const lines = formatZoomTrace([
      at(0, 'start', { focalX: 214, focalY: 120 }),
      at(33, 'update', { live: 1.42, pointers: 2, focalX: 214, focalY: 118, rawX: 240, rawY: -3, x: 90, y: -3, limX: 90, limY: 51 }),
      at(812, 'end', { live: 4, committed: 4, rawX: 118, rawY: -42, x: 118, y: -42, limX: 646, limY: 363, boxH: 466, note: 'box 242→466' }),
      at(845, 'box', { live: 4, committed: 4, drawnH: 260, boxH: 466 }),
    ]).split('\n')
    expect(lines[0]).toBe('   +0ms  start   live 1.00  committed 1.00  focal 214,120  box 430x242')
    expect(lines[1]).toBe('  +33ms  update  live 1.42  committed 1.00  2 fingers  focal 214,118  pan 90,-3 (raw 240,-3 CLAMPED x)  limit ±90,±51  box 430x242')
    expect(lines[2]).toBe(' +812ms  end     live 4.00  committed 4.00  pan 118,-42 (raw 118,-42)  limit ±646,±363  box 430x466  box 242→466')
    expect(lines[3]).toBe(' +845ms  box     live 4.00  committed 4.00  drawn 260 of 466 asked  box 430x466')
  })

  it('says so when a pan sits on its limit — that is the wall the operator feels', () => {
    const line = formatZoomTrace([
      at(10, 'update', { live: 2, pointers: 2, rawX: 300, rawY: 0, x: 215, y: 0, limX: 215, limY: 0 }),
    ])
    expect(line).toContain('pan 215,0 (raw 300,0 CLAMPED x)')
    expect(line).toContain('limit ±215,±0')
  })
})
