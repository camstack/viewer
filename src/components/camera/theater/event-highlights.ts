/**
 * Pure helpers painting the theater timeline's surfaces: the 24h heatmap strip
 * (bins + positioned highlights, by day-fraction) and the activity/class
 * filters the timeline applies to its track-shaped detection rows. Kind colours
 * come from the hub display palette (`shared/palette.ts`); motion and audio are
 * entries of that palette, not a second table.
 *
 * Everything here is fed by the SAME object-detection rows the vertical
 * timeline clusters. The `EventItem`-shaped variants (`filterEvents`,
 * `eventsToHeatmapHighlights`, `eventsToListHighlights`) were deleted on
 * 2026-09-24 together with the `events` cap and `use-events.ts`: that cap never
 * had a provider, so those projections had never run against real data.
 *
 * Pure & deterministic given their inputs — no fetching, no Date.now.
 */
import { audioPaint, audioScaleColors, getPaletteView, paintKind } from '../../../../shared/palette.js'
import { AUDIO_LEVEL_STEPS } from '../audio-level.js'
import type { ActivityFilter, HeatmapBin } from './mock-data.js'
import { HEATMAP_BINS, isFilterAll } from './mock-data.js'
import type { Bucket } from './activity-bars.js'
import { dayBounds } from '../../../lib/local-day.js'

/** Length of the local calendar day that contains `dayStartMs`. */
function viewedDaySpanMs(dayStartMs: number): number {
  const { startMs, endMs } = dayBounds(dayStartMs)
  return endMs - startMs
}

/** Minimal shape of an object-detection event used by the heatmap projections —
 *  structurally compatible with `ObjectEvent` (id + epoch-ms timestamp + class). */
export interface DetectionLike {
  readonly id: string
  readonly timestamp: number
  readonly className: string
}

/** Known detection subs → the three theater macros, so a heatmap slot without
 *  a live taxonomy map still paints person / vehicle / animal. */
const FALLBACK_MACRO: Readonly<Record<string, string>> = {
  person: 'person',
  face: 'person',
  vehicle: 'vehicle',
  car: 'vehicle',
  truck: 'vehicle',
  bus: 'vehicle',
  motorcycle: 'vehicle',
  bicycle: 'vehicle',
  airplane: 'vehicle',
  boat: 'vehicle',
  train: 'vehicle',
  animal: 'animal',
  bird: 'animal',
  dog: 'animal',
  cat: 'animal',
  horse: 'animal',
  sheep: 'animal',
  cow: 'animal',
  elephant: 'animal',
  bear: 'animal',
  zebra: 'animal',
  giraffe: 'animal',
}

/** Color a class as its theater macro (person / vehicle / animal). */
export function classPaintColor(
  className: string,
  toMacro?: ReadonlyMap<string, string>,
): string {
  const macro = toMacro?.get(className) ?? FALLBACK_MACRO[className] ?? className
  return paintKind(getPaletteView(), macro)
}

/** Colour an event by its kind. Motion, audio and every class are palette entries. */
export function colorForEventType(type: string): string {
  return paintKind(getPaletteView(), type)
}

/** Minimal item shape the activity-kind filter needs (structural — the
 *  timeline's track-shaped `ObjectEvent` carries `audioLabels`). */
export interface AudioEnrichable {
  readonly audioLabels?: readonly string[]
}

/** Minimal item shape the class filter needs (structural — track items carry a
 *  single `className`; aggregated shapes may carry a `classes` list). */
export interface ClassEnrichable {
  readonly className?: string
  readonly classes?: readonly string[]
}

/** The classes an item advertises for the class filter: its `className` plus
 *  any aggregated `classes[]`. */
function itemClasses(item: ClassEnrichable): readonly string[] {
  const out: string[] = []
  if (typeof item.className === 'string' && item.className.length > 0) out.push(item.className)
  if (item.classes) out.push(...item.classes)
  return out
}

/** Shared empty selection — "all classes" (keeps default params referentially
 *  stable so the same-reference pass-through contract holds). */
const ALL_CLASSES: ReadonlySet<string> = new Set()

/**
 * Apply a detection-class selection to the timeline's items. An EMPTY selection
 * means "all classes" (pass-through, same reference); otherwise an item passes
 * when ANY of its classes (`className` + `classes[]`) is selected.
 *
 * The timeline legend is MACRO-only: `toMacro` (kind→macro) collapses each
 * item's classes to their macro before matching, so selecting a macro (e.g.
 * `vehicle`) matches a `car`/`truck` item. Absent ⇒ exact class match.
 */
export function filterDetectionsByClass<T extends ClassEnrichable>(
  events: readonly T[],
  classes: ReadonlySet<string>,
  toMacro?: ReadonlyMap<string, string>,
): readonly T[] {
  if (classes.size === 0) return events
  const macroOf = (c: string): string => toMacro?.get(c) ?? c
  return events.filter((e) => itemClasses(e).some((c) => classes.has(macroOf(c))))
}

/**
 * Apply the activity chips to the timeline's TRACK-shaped detection items:
 * the motion/audio KINDS first, then the detection-CLASS selection.
 *
 * Kinds: every visual track is motion-kind, so "all" and any selection
 * including `motion` pass everything; an AUDIO-ONLY selection keeps only tracks
 * that carry audio enrichment (audio labels heard during the track's life).
 *
 * Classes: an empty selection is "all"; otherwise a track passes if ANY of its
 * classes is selected (see `filterDetectionsByClass`).
 */
export function filterDetectionsByKind<T extends AudioEnrichable & ClassEnrichable>(
  events: readonly T[],
  filter: ActivityFilter,
  classes: ReadonlySet<string> = ALL_CLASSES,
  toMacro?: ReadonlyMap<string, string>,
): readonly T[] {
  const kindFiltered =
    isFilterAll(filter) || filter.has('motion')
      ? events
      : events.filter((e) => (e.audioLabels?.length ?? 0) > 0)
  return filterDetectionsByClass(kindFiltered, classes, toMacro)
}

/**
 * Merge REAL audio activity buckets (from `useTimelineActivity`) into the
 * heatmap bins' `audio` channel for the viewed day. Each bucket paints every
 * bin it overlaps with its intensity (max wins on overlap); buckets outside
 * the day are dropped. Returns the same reference when nothing lands in-day.
 */
export function mergeAudioIntoHeatmapBins(
  bins: readonly HeatmapBin[],
  audio: readonly Bucket[],
  dayStartMs: number,
): readonly HeatmapBin[] {
  if (audio.length === 0 || bins.length === 0) return bins
  const binMs = viewedDaySpanMs(dayStartMs) / bins.length
  const levels = new Array<number>(bins.length).fill(0)
  let any = false
  for (const b of audio) {
    if (b.intensity <= 0 || b.endMs <= b.startMs) continue
    const first = Math.floor((b.startMs - dayStartMs) / binMs)
    // endMs is exclusive — subtract 1ms so a bucket ending ON a bin boundary
    // does not bleed into the next bin.
    const last = Math.floor((b.endMs - 1 - dayStartMs) / binMs)
    for (let i = Math.max(0, first); i <= Math.min(bins.length - 1, last); i++) {
      if (b.intensity > levels[i]) {
        levels[i] = b.intensity
        any = true
      }
    }
  }
  if (!any) return bins
  return bins.map((bin, i): HeatmapBin =>
    levels[i] > bin.audio ? { ...bin, audio: levels[i] } : bin,
  )
}

/**
 * Merge REAL motion-density buckets (`getEventDensity`) into the heatmap's
 * `motion` channel. Same overlap/max rule as audio; detection and audio stay
 * put so the stacked lanes can paint independently.
 */
export function mergeMotionIntoHeatmapBins(
  bins: readonly HeatmapBin[],
  motion: readonly Bucket[],
  dayStartMs: number,
): readonly HeatmapBin[] {
  if (motion.length === 0 || bins.length === 0) return bins
  const binMs = viewedDaySpanMs(dayStartMs) / bins.length
  const levels = new Array<number>(bins.length).fill(0)
  let any = false
  for (const b of motion) {
    if (b.intensity <= 0 || b.endMs <= b.startMs) continue
    const first = Math.floor((b.startMs - dayStartMs) / binMs)
    const last = Math.floor((b.endMs - 1 - dayStartMs) / binMs)
    for (let i = Math.max(0, first); i <= Math.min(bins.length - 1, last); i++) {
      if (b.intensity > levels[i]) {
        levels[i] = b.intensity
        any = true
      }
    }
  }
  if (!any) return bins
  return bins.map((bin, i): HeatmapBin =>
    levels[i] > bin.motion ? { ...bin, motion: levels[i] } : bin,
  )
}

/** A positioned highlight on the 24h heatmap strip. */
export interface HeatmapHighlight {
  readonly id: string
  readonly fraction: number
  readonly color: string
}

/**
 * Project OBJECT-DETECTION events (the SAME data that drives the vertical
 * timeline's clusters) onto the 24h heatmap strip for a SPECIFIC viewed day
 * (`dayStartMs`, midnight ms). This replaced the `useEvents`-sourced markers
 * (deleted 2026-09-24 with the `events` cap), which (a) came from a different
 * cap than the timeline clusters — so a cluster
 * could show on the timeline with no marker on the heatmap — and (b) projected
 * against `nowMs`'s day, so on a past day every marker fell outside [0,1] and
 * vanished. Sharing the cluster source + keying on the viewed day makes the two
 * surfaces agree, on today AND on previous days. Events outside the day drop.
 */
export function objectEventsToHeatmapHighlights(
  events: readonly DetectionLike[],
  dayStartMs: number,
): readonly HeatmapHighlight[] {
  const span = viewedDaySpanMs(dayStartMs)
  const out: HeatmapHighlight[] = []
  for (const e of events) {
    const frac = (e.timestamp - dayStartMs) / span
    if (frac < 0 || frac > 1) continue
    out.push({ id: e.id, fraction: frac, color: paintKind(getPaletteView(), e.className) })
  }
  return out
}

/**
 * Bucket the SAME object-detection events into the heatmap's `HEATMAP_BINS`
 * columns for the viewed day, as REAL detection density. Each bin's
 * `detection` is its count normalised to the busiest bin (0..1); `motion` is
 * left 0 here (`mergeMotionIntoHeatmapBins` fills that lane from
 * getEventDensity). `recorded` stays false — coverage is a separate lane.
 */
export function objectEventsToHeatmapBins(
  events: readonly DetectionLike[],
  dayStartMs: number,
  toMacro?: ReadonlyMap<string, string>,
): readonly HeatmapBin[] {
  const span = viewedDaySpanMs(dayStartMs)
  const counts = new Array<number>(HEATMAP_BINS).fill(0)
  const classCounts: Record<string, number>[] = Array.from(
    { length: HEATMAP_BINS },
    () => ({}),
  )
  for (const e of events) {
    const frac = (e.timestamp - dayStartMs) / span
    if (frac < 0 || frac >= 1) continue
    const i = Math.min(HEATMAP_BINS - 1, Math.floor(frac * HEATMAP_BINS))
    counts[i]++
    const name = toMacro?.get(e.className) ?? FALLBACK_MACRO[e.className] ?? e.className
    classCounts[i][name] = (classCounts[i][name] ?? 0) + 1
  }
  let max = 0
  for (const c of counts) if (c > max) max = c
  return counts.map((c, i): HeatmapBin => {
    const dominant = dominantClass(classCounts[i])
    return {
      motion: 0,
      detection: max > 0 ? c / max : 0,
      ...(dominant !== undefined ? { detectionColor: paintKind(getPaletteView(), dominant) } : {}),
      audio: 0,
      recorded: false,
    }
  })
}

/**
 * Every source the day tape can draw. Each is OPTIONAL, and an omitted source
 * is exactly an empty one: that is how a caller turns a lane off (the theater's
 * motion/audio chips) and how a surface that never asks for a source — the
 * on-demand overlay does not pay for the tracks query — simply does not draw
 * its lane.
 */
export interface HeatmapBinSources {
  /** Midnight of the VIEWED day, epoch ms. */
  readonly dayStartMs: number
  /** Object detections, the same rows the vertical timeline clusters. */
  readonly detections?: readonly DetectionLike[]
  /** Motion density buckets (`getEventDensity`). */
  readonly motion?: readonly Bucket[]
  /** Audio density buckets (same call). */
  readonly audio?: readonly Bucket[]
  /** Live taxonomy map, for the detection lane's dominant-class colour. */
  readonly classToMacro?: ReadonlyMap<string, string>
}

/**
 * Build the day tape's bins from every lane at once.
 *
 * The ONE composition, because `HeatmapBar` is mounted by more than one
 * surface and each of them was otherwise free to feed it fewer lanes than the
 * last. The on-demand overlay fed it a module-level empty array and drew a tape
 * with nothing but the recording hairline on it — the operator's report.
 *
 * Order matters and is not a preference: {@link objectEventsToHeatmapBins} is
 * the only step that MINTS the strip (it returns `HEATMAP_BINS` columns for an
 * empty input too), and both merges bail on a zero-length `bins`. So the
 * detection projection runs first whether or not there are detections, and the
 * two density merges then fill their own channel and leave the others put.
 */
export function composeHeatmapBins(sources: HeatmapBinSources): readonly HeatmapBin[] {
  const bins = objectEventsToHeatmapBins(
    sources.detections ?? [],
    sources.dayStartMs,
    sources.classToMacro,
  )
  const withMotion = mergeMotionIntoHeatmapBins(bins, sources.motion ?? [], sources.dayStartMs)
  return mergeAudioIntoHeatmapBins(withMotion, sources.audio ?? [], sources.dayStartMs)
}

function dominantClass(counts: Record<string, number>): string | undefined {
  let best: string | undefined
  let n = 0
  for (const [name, c] of Object.entries(counts)) {
    if (c > n) {
      n = c
      best = name
    }
  }
  return best
}

/** Map a 0..1 tape intensity onto the live meter's 0..5 rung. */
export function audioIntensityToRung(intensity: number): number {
  const t = Math.min(1, Math.max(0, intensity))
  if (t <= 0) return 0
  return Math.min(AUDIO_LEVEL_STEPS - 1, Math.ceil(t * AUDIO_LEVEL_STEPS) - 1)
}

/**
 * Colour an audio peak by intensity (0..1): the palette's audio hex, paler
 * when quiet. The six alphas are the gradient on that entry. The live meter
 * keeps its own green → red rungs (`audio-level.ts`).
 */
export function audioPeakColor(intensity: number): string {
  const audio = audioPaint(getPaletteView())
  return audioScaleColors()[audioIntensityToRung(intensity)] ?? audio.hex
}

export interface HeatmapBinLayer {
  readonly color: string
  readonly heightPct: number
}

export interface HeatmapBinLayers {
  readonly bottom: HeatmapBinLayer | null
  readonly audio: HeatmapBinLayer | null
}

/** Bottom fill occupies up to this fraction of the tape; audio peaks hang from the top. */
const BOTTOM_FILL_MAX_PCT = 70
const AUDIO_PEAK_MAX_PCT = 70

/**
 * Paint plan for one heatmap column: bottom is motion, or the prominent
 * detection class when any object is in the slot; audio hangs from the top.
 */
export function heatmapBinLayers(bin: HeatmapBin): HeatmapBinLayers {
  const motion = paintKind(getPaletteView(), 'motion')
  const bottom =
    bin.detection > 0
      ? {
          color: bin.detectionColor ?? motion,
          heightPct: Math.max(12, bin.detection * BOTTOM_FILL_MAX_PCT),
        }
      : bin.motion > 0
        ? {
            color: motion,
            heightPct: Math.max(12, bin.motion * BOTTOM_FILL_MAX_PCT),
          }
        : null
  const audio =
    bin.audio > 0
      ? { color: audioPeakColor(bin.audio), heightPct: Math.max(10, bin.audio * AUDIO_PEAK_MAX_PCT) }
      : null
  return { bottom, audio }
}

