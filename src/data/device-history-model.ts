/**
 * The device history, as the viewer draws it: a window, the series a device
 * keeps, and the points of one series turned into state bands (boolean / enum)
 * or line segments (gauge / counter). Pure; the reads are in
 * `use-device-history.ts`.
 *
 * A trimmed port of the admin library's history model: the viewer principal is
 * not an admin, so it reads one series at a time (`query`), never `queryMany`.
 * A stored `null` is unknown, never zero (D393): it breaks a line and leaves a
 * gap between bands.
 */
import { isRecord } from './cap-query.js'

export type HistoryWindowId = '24h' | '7d' | '30d'
export const HISTORY_WINDOW_IDS: readonly HistoryWindowId[] = ['24h', '7d', '30d']

const HOUR_MS = 3_600_000
const HISTORY_WINDOW_MS: Readonly<Record<HistoryWindowId, number>> = {
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
  '30d': 30 * 24 * HOUR_MS,
}

export interface HistoryWindow {
  readonly from: number
  readonly to: number
}

export function historyWindow(id: HistoryWindowId, now: number): HistoryWindow {
  return { from: now - HISTORY_WINDOW_MS[id], to: now }
}

export type SeriesKind = 'gauge' | 'counter' | 'boolean' | 'enum'

export interface SeriesInfo {
  readonly key: string
  readonly scope: string
  readonly kind: SeriesKind
  readonly unit: string | null
  readonly displayName: string
  readonly values: readonly string[] | null
  readonly firstTs: number
  readonly lastTs: number
}

function isKind(v: unknown): v is SeriesKind {
  return v === 'gauge' || v === 'counter' || v === 'boolean' || v === 'enum'
}

function stringList(v: unknown): readonly string[] | null {
  return Array.isArray(v) && v.every((s): s is string => typeof s === 'string') ? v : null
}

export function toSeriesInfo(raw: unknown): SeriesInfo | null {
  if (!isRecord(raw)) return null
  const { key, scope, kind, unit, displayName, values, firstTs, lastTs } = raw
  if (typeof key !== 'string' || typeof scope !== 'string' || !isKind(kind)) return null
  return {
    key,
    scope,
    kind,
    unit: typeof unit === 'string' ? unit : null,
    displayName: typeof displayName === 'string' && displayName !== '' ? displayName : key,
    values: stringList(values),
    firstTs: typeof firstTs === 'number' ? firstTs : 0,
    lastTs: typeof lastTs === 'number' ? lastTs : 0,
  }
}

export function toSeriesList(raw: unknown): readonly SeriesInfo[] | null {
  if (!Array.isArray(raw)) return null
  const out: SeriesInfo[] = []
  for (const row of raw) {
    const info = toSeriesInfo(row)
    if (info !== null) out.push(info)
  }
  return out
}

/** One sample: a number for a gauge / counter / boolean, a state name for an enum. */
export interface HistorySample {
  readonly t: number
  readonly value: number | null
  readonly state: string | null
}

export interface SeriesSamples {
  /** The value held when the window opens, when the hub knew one. */
  readonly before: HistorySample | null
  readonly samples: readonly HistorySample[]
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function dominantState(states: unknown): string | null {
  if (!isRecord(states)) return null
  let best: string | null = null
  let bestMs = -1
  for (const [name, ms] of Object.entries(states)) {
    if (typeof ms === 'number' && ms > bestMs) {
      best = name
      bestMs = ms
    }
  }
  return best
}

function toSample(raw: unknown, kind: SeriesKind): HistorySample | null {
  if (!isRecord(raw)) return null
  const t = num(raw.t)
  if (t === null) return null
  const state = typeof raw.state === 'string' ? raw.state : dominantState(raw.states)
  const value =
    kind === 'gauge' ? (num(raw.twMean) ?? num(raw.mean) ?? num(raw.last))
    : kind === 'counter' ? num(raw.delta)
    : (num(raw.last) ?? num(raw.twMean))
  return { t, value, state }
}

/** Narrows a `deviceHistory.query` answer to the samples of its first scope. */
export function toSeriesSamples(raw: unknown, kind: SeriesKind): SeriesSamples | null {
  if (!isRecord(raw) || !Array.isArray(raw.series)) return null
  const first: unknown = raw.series[0]
  if (!isRecord(first) || !Array.isArray(first.points)) return null
  const samples: HistorySample[] = []
  for (const p of first.points) {
    const s = toSample(p, kind)
    if (s !== null) samples.push(s)
  }
  let before: HistorySample | null = null
  if (isRecord(first.before)) {
    const t = num(first.before.t)
    if (t !== null) {
      before = {
        t,
        value: num(first.before.value),
        state: typeof first.before.state === 'string' ? first.before.state : null,
      }
    }
  }
  return { before, samples }
}

/** The band label of a sample: the enum state, or on / off for a boolean. */
export type BandLabel = string

export interface StateBand {
  readonly from: number
  readonly to: number
  /** An enum state name, or `on` / `off` for a boolean. */
  readonly label: BandLabel
}

function bandLabel(kind: SeriesKind, s: HistorySample): BandLabel | null {
  if (kind === 'enum') return s.state
  if (s.value === null) return null
  return s.value >= 0.5 ? 'on' : 'off'
}

/** Each sample holds its value until the next one; the last holds to the window's end. */
export function stateBands(kind: SeriesKind, data: SeriesSamples, window: HistoryWindow): readonly StateBand[] {
  const held = data.before === null ? [] : [{ ...data.before, t: window.from }]
  const all = [...held, ...data.samples.filter((s) => s.t >= window.from && s.t <= window.to)]
  const bands: StateBand[] = []
  all.forEach((sample, i) => {
    const label = bandLabel(kind, sample)
    if (label === null) return
    const from = Math.max(sample.t, window.from)
    const to = i + 1 < all.length ? Math.min(all[i + 1].t, window.to) : window.to
    if (to <= from) return
    const prev = bands[bands.length - 1]
    if (prev !== undefined && prev.label === label && prev.to === from) {
      bands[bands.length - 1] = { ...prev, to }
    } else {
      bands.push({ from, to, label })
    }
  })
  return bands
}

export interface LinePoint {
  readonly t: number
  readonly v: number
}

/** The numeric points as runs: an unknown value breaks the line, never reads as zero. */
export function lineSegments(data: SeriesSamples, window: HistoryWindow): readonly (readonly LinePoint[])[] {
  const all = [...(data.before === null ? [] : [{ ...data.before, t: window.from }]), ...data.samples]
  const segments: LinePoint[][] = []
  let run: LinePoint[] = []
  for (const s of all) {
    if (s.t < window.from || s.t > window.to) continue
    if (s.value === null) {
      if (run.length > 0) segments.push(run)
      run = []
    } else {
      run.push({ t: s.t, v: s.value })
    }
  }
  if (run.length > 0) segments.push(run)
  return segments
}

export interface ValueRange {
  readonly min: number
  readonly max: number
}

/** The y range of the segments, padded so a flat line is not drawn on the edge. */
export function valueRange(segments: readonly (readonly LinePoint[])[]): ValueRange | null {
  let min = Infinity
  let max = -Infinity
  for (const seg of segments) {
    for (const p of seg) {
      if (p.v < min) min = p.v
      if (p.v > max) max = p.v
    }
  }
  if (min === Infinity) return null
  if (min === max) return { min: min - 1, max: max + 1 }
  return { min, max }
}

/** Where `t` falls across `width`, 0..width. */
export function xAt(t: number, window: HistoryWindow, width: number): number {
  const span = window.to - window.from
  if (span <= 0) return 0
  return Math.min(width, Math.max(0, ((t - window.from) / span) * width))
}

/** A device run (a wash, a dry cycle) as a band across the window. */
export interface RunBand {
  readonly from: number
  readonly to: number
  readonly outcome: string | null
  readonly open: boolean
}

export function toRunBands(raw: unknown, window: HistoryWindow): readonly RunBand[] {
  if (!isRecord(raw) || !Array.isArray(raw.runs)) return []
  const out: RunBand[] = []
  for (const run of raw.runs) {
    if (!isRecord(run)) continue
    const startedAt = num(run.startedAt)
    if (startedAt === null) continue
    const endedAt = num(run.endedAt)
    const to = Math.min(endedAt ?? window.to, window.to)
    const from = Math.max(startedAt, window.from)
    if (to <= from) continue
    out.push({ from, to, outcome: typeof run.outcome === 'string' ? run.outcome : null, open: endedAt === null })
  }
  return out.sort((a, b) => a.from - b.from)
}
