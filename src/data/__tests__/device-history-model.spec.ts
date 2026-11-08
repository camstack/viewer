import { describe, expect, it } from 'vitest'
import {
  historyWindow,
  lineSegments,
  stateBands,
  toRunBands,
  toSeriesList,
  toSeriesSamples,
  valueRange,
  xAt,
} from '../device-history-model.js'

const NOW = 1_000_000_000
const H = 3_600_000
const WIN = historyWindow('24h', NOW)

const point = (t: number, extra: Record<string, unknown>) => ({
  t, samples: 1, mean: null, twMean: null, min: 0, max: 0, last: null, delta: null, state: null, states: null, ...extra,
})

describe('historyWindow', () => {
  it('spans 24 hours, 7 days and 30 days ending now', () => {
    expect(historyWindow('24h', NOW)).toEqual({ from: NOW - 24 * H, to: NOW })
    expect(historyWindow('7d', NOW).from).toBe(NOW - 168 * H)
    expect(historyWindow('30d', NOW).from).toBe(NOW - 720 * H)
  })
})

describe('toSeriesList', () => {
  it('keeps well-formed series and drops the rest; null while unanswered', () => {
    const list = toSeriesList([
      { key: 'power', scope: '', kind: 'gauge', unit: 'W', displayName: 'Power', values: null, firstTs: 1, lastTs: 2 },
      { key: 'bad', kind: 'nope' },
      7,
    ])
    expect(list?.map((s) => s.key)).toEqual(['power'])
    expect(toSeriesList(undefined)).toBeNull()
  })
})

describe('stateBands', () => {
  it('holds a boolean until the next sample, seeded by the value before the window', () => {
    const data = toSeriesSamples(
      { series: [{ scope: '', before: { t: 1, value: 1, state: null }, derivedFrom: null,
        points: [point(NOW - 20 * H, { last: 0 }), point(NOW - 5 * H, { last: 1 })] }] },
      'boolean',
    )!
    const bands = stateBands('boolean', data, WIN)
    expect(bands.map((b) => [b.label, (b.to - b.from) / H])).toEqual([['on', 4], ['off', 15], ['on', 5]])
  })

  it('merges equal neighbours and leaves a gap for an unknown value (never off)', () => {
    const data = toSeriesSamples(
      { series: [{ scope: '', before: null, derivedFrom: null,
        points: [point(NOW - 10 * H, { last: 1 }), point(NOW - 8 * H, { last: 1 }), point(NOW - 6 * H, { last: null }), point(NOW - 2 * H, { last: 0 })] }] },
      'boolean',
    )!
    const bands = stateBands('boolean', data, WIN)
    expect(bands.map((b) => b.label)).toEqual(['on', 'off'])
    expect((bands[0].to - bands[0].from) / H).toBe(4)
  })

  it('names an enum by its state, or the dominant state of a rollup', () => {
    const data = toSeriesSamples(
      { series: [{ scope: '', before: null, derivedFrom: null,
        points: [point(NOW - 10 * H, { state: 'heat' }), point(NOW - 4 * H, { states: { idle: 5, cool: 90 } })] }] },
      'enum',
    )!
    expect(stateBands('enum', data, WIN).map((b) => b.label)).toEqual(['heat', 'cool'])
  })
})

describe('lineSegments', () => {
  it('breaks the line at an unknown value and prefers the time-weighted mean', () => {
    const data = toSeriesSamples(
      { series: [{ scope: '', before: null, derivedFrom: null,
        points: [point(NOW - 9 * H, { mean: 1, twMean: 2 }), point(NOW - 8 * H, { mean: 3 }), point(NOW - 7 * H, {}), point(NOW - 6 * H, { mean: 5 })] }] },
      'gauge',
    )!
    const segs = lineSegments(data, WIN)
    expect(segs.map((s) => s.map((p) => p.v))).toEqual([[2, 3], [5]])
    expect(valueRange(segs)).toEqual({ min: 2, max: 5 })
  })

  it('pads a flat range and reports none for no data', () => {
    expect(valueRange([[{ t: 1, v: 4 }]])).toEqual({ min: 3, max: 5 })
    expect(valueRange([])).toBeNull()
  })
})

describe('xAt', () => {
  it('maps the window onto the width and clamps', () => {
    expect(xAt(WIN.from, WIN, 200)).toBe(0)
    expect(xAt(NOW - 12 * H, WIN, 200)).toBe(100)
    expect(xAt(NOW + H, WIN, 200)).toBe(200)
  })
})

describe('toRunBands', () => {
  it('clips runs to the window, keeps an open run to now, sorted by start', () => {
    const bands = toRunBands(
      { runs: [
        { startedAt: NOW - 2 * H, endedAt: null, outcome: null },
        { startedAt: NOW - 30 * H, endedAt: NOW - 22 * H, outcome: 'completed' },
      ], nextCursor: null },
      WIN,
    )
    expect(bands).toEqual([
      { from: WIN.from, to: NOW - 22 * H, outcome: 'completed', open: false },
      { from: NOW - 2 * H, to: NOW, outcome: null, open: true },
    ])
  })
})
