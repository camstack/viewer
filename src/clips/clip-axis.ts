/**
 * clip-axis — the theater timeline's COMPRESSED time axis for clips mode.
 *
 * The theater timeline is to-scale: an empty hour occupies an hour of pixels.
 * Clips mode keeps the same chrome (playback bar, 16:9 cluster cards, footer)
 * but collapses the dead time between visits so the operator scrolls footage,
 * not night. Each clip is a FIXED card (`sizePx`); every hole longer than
 * `minGapMs` becomes a `gapPx` ellipsis. Visit merging is NOT done here — that
 * is the videoclips provider. Three consecutive heartbeats stay three cards.
 *
 * Newest footage sits at offset 0 (the live edge). Scrolling down goes back in
 * time, matching `epochToOffset` / `offsetToEpoch` on the linear timeline.
 *
 * Pure: no React, no i18n. Geometry only.
 */

import type { Clip } from './clip-model.js'
import { clipDurationMs } from './clip-model.js'
import { normalizeClips } from './clip-timeline.js'

export interface ClipAxisOptions {
  /** Live-edge epoch. Offset 0 maps here. */
  readonly topMs: number
  /** Cluster-card height. Every clip occupies exactly this, regardless of duration. */
  readonly sizePx: number
  /** Fixed height of a collapsed-gap ellipsis (and the minimum visual gap between cards). */
  readonly gapPx: number
  /** Holes shorter than this are not labelled — cards still do not overlap. */
  readonly minGapMs: number
}

export interface ClipAxisClipSlot {
  readonly kind: 'clip'
  readonly clip: Clip
  readonly topPx: number
  readonly heightPx: number
}

export interface ClipAxisGapSlot {
  readonly kind: 'gap'
  /** Newer edge of the hole (closer to live). */
  readonly fromMs: number
  /** Older edge of the hole. */
  readonly toMs: number
  readonly durationMs: number
  readonly topPx: number
  readonly heightPx: number
}

export type ClipAxisSlot = ClipAxisClipSlot | ClipAxisGapSlot

export interface ClipAxis {
  readonly slots: readonly ClipAxisSlot[]
  /** Newest-first. Callers that index clips MUST use this list. */
  readonly clips: readonly Clip[]
  readonly contentSpanPx: number
  readonly collapsedMs: number
}

export const EMPTY_CLIP_AXIS: ClipAxis = {
  slots: [],
  clips: [],
  contentSpanPx: 0,
  collapsedMs: 0,
}

/**
 * Newest-first clip list. `normalizeClips` is oldest-first (ribbon order); the
 * theater inverts it so the live edge stays at the top.
 */
export function newestFirstClips(clips: readonly Clip[]): readonly Clip[] {
  return [...normalizeClips(clips)].reverse()
}

export function buildClipAxis(
  clips: readonly Clip[],
  options: ClipAxisOptions,
): ClipAxis {
  const ordered = newestFirstClips(clips)
  if (ordered.length === 0) return EMPTY_CLIP_AXIS

  const slots: ClipAxisSlot[] = []
  let cursorPx = 0
  let collapsedMs = 0

  const newest = ordered[0]!
  const leadingHole = options.topMs - newest.endMs
  if (leadingHole >= options.minGapMs) {
    slots.push({
      kind: 'gap',
      fromMs: options.topMs,
      toMs: newest.endMs,
      durationMs: leadingHole,
      topPx: cursorPx,
      heightPx: options.gapPx,
    })
    cursorPx += options.gapPx
    collapsedMs += leadingHole
  }

  ordered.forEach((clip, index) => {
    slots.push({
      kind: 'clip',
      clip,
      topPx: cursorPx,
      heightPx: options.sizePx,
    })
    cursorPx += options.sizePx

    const older = ordered[index + 1]
    if (older === undefined) return

    const holeMs = clip.startMs - older.endMs
    const labelled = holeMs >= options.minGapMs
    slots.push({
      kind: 'gap',
      fromMs: clip.startMs,
      toMs: older.endMs,
      durationMs: Math.max(0, holeMs),
      topPx: cursorPx,
      heightPx: options.gapPx,
    })
    cursorPx += options.gapPx
    if (labelled) collapsedMs += holeMs
  })

  return { slots, clips: ordered, contentSpanPx: cursorPx, collapsedMs }
}

/** Scroll offset of an epoch. Live-or-future → 0. Empty axis → 0. */
export function clipAxisEpochToOffset(axis: ClipAxis, epochMs: number): number {
  if (axis.slots.length === 0) return 0

  for (const slot of axis.slots) {
    if (slot.kind === 'clip') {
      if (epochMs >= slot.clip.startMs && epochMs <= slot.clip.endMs) {
        const duration = clipDurationMs(slot.clip)
        if (duration <= 0) return slot.topPx
        const fraction = (slot.clip.endMs - epochMs) / duration
        return slot.topPx + fraction * slot.heightPx
      }
    } else if (epochMs < slot.fromMs && epochMs > slot.toMs) {
      // Collapsed hole has no scale — every moment in it is the marker itself.
      return slot.topPx + slot.heightPx / 2
    }
  }

  const firstClip = axis.clips[0]
  if (firstClip !== undefined && epochMs >= firstClip.endMs) return 0
  return axis.contentSpanPx
}

/**
 * The smallest step a tick's HH:MM label can tell apart from its neighbour.
 * A clip shorter than this cannot host even one meaningfully distinct tick —
 * see {@link clipAxisTicks}.
 */
const MIN_TICK_STEP_MS = 60_000

export interface ClipAxisTickOptions {
  /**
   * Target vertical gap between ticks, in px. A clip is a FIXED-height card
   * regardless of how much wall-clock time it holds (`buildClipAxis`'s
   * `sizePx`), so a three-hour clip and a three-minute one occupy the same
   * pixels — a step derived from wall-clock time alone (like the linear
   * axis's hour grid) would either flood the short one or crowd the long one.
   * Ticks are instead evenly divided across each clip's OWN height, so
   * density stays legible card to card.
   */
  readonly targetSpacingPx: number
}

/**
 * Ruler ticks for the compressed clips axis.
 *
 * The operator's rule, verbatim: discontinuous is fine as long as it is
 * continuous within one clip's interval. So a tick is derived PER CLIP, from
 * that clip's own linear time↔pixel scale, and only ever emitted strictly
 * INSIDE that clip's `[startMs, endMs]` — never on a gap slot, never on a
 * clip boundary (the card edge already draws that line). A clip too short to
 * fit even one step at the target spacing — including one shorter than
 * {@link MIN_TICK_STEP_MS}, below which two ticks would carry the same HH:MM
 * label — contributes no ticks at all, which is correct: nothing lies, it is
 * just silent where there is nothing meaningful to mark.
 *
 * Pure: no React, no i18n. Order matches `axis.slots` (newest-first).
 */
export function clipAxisTicks(
  axis: ClipAxis,
  options: ClipAxisTickOptions,
): readonly number[] {
  const spacingPx = Math.max(1, options.targetSpacingPx)
  const ticks: number[] = []

  for (const slot of axis.slots) {
    if (slot.kind !== 'clip') continue
    const duration = clipDurationMs(slot.clip)
    if (duration <= 0 || slot.heightPx <= 0) continue

    // ⚠ A BOUNDARY tick, always. The first version emitted only INTERIOR
    // divisions and shipped a ruler that was mathematically empty: it gated on
    // `floor(duration / 60_000) >= 1`, and real clips on this fleet last
    // SECONDS, so every clip took the `continue` and the operator saw no ruler
    // at all in v1.0.396. The gate was defensible on its own terms (two HH:MM
    // labels a few seconds apart read identically) and it was never checked
    // against a real duration.
    //
    // The clip's newest edge is the honest anchor: unlike an interpolated
    // interior instant it is a moment that DEFINITELY exists on this axis, it
    // is where the card begins, and one label per clip is what makes the left
    // gutter scannable — which is the whole point of a ruler here.
    ticks.push(slot.clip.endMs)

    // Interior divisions on top, when the clip is both long enough for two
    // labels to differ and tall enough not to crowd.
    const byPixels = Math.floor(slot.heightPx / spacingPx)
    const byDuration = Math.floor(duration / MIN_TICK_STEP_MS)
    const count = Math.min(byPixels, byDuration)
    if (count < 1) continue

    const stepMs = duration / (count + 1)
    for (let i = 1; i <= count; i++) {
      ticks.push(Math.round(slot.clip.endMs - i * stepMs))
    }
  }

  return ticks
}

/**
 * Inverse of {@link clipAxisEpochToOffset}. A finger on a gap lands on the
 * next footage (the older clip's end), never inside the hole. Offset 0 is
 * `topMs` (the live edge).
 */
export function clipAxisOffsetToEpoch(axis: ClipAxis, topMs: number, offsetY: number): number {
  if (axis.slots.length === 0) return topMs
  if (offsetY <= 0) return topMs

  const clamped = Math.min(offsetY, Math.max(0, axis.contentSpanPx))
  for (const slot of axis.slots) {
    if (clamped < slot.topPx || clamped > slot.topPx + slot.heightPx) continue
    if (slot.kind === 'gap') {
      // Skip the hole: the card below (older footage) starts at its newest edge.
      return slot.toMs
    }
    const duration = clipDurationMs(slot.clip)
    if (duration <= 0 || slot.heightPx <= 0) return slot.clip.endMs
    const fraction = (clamped - slot.topPx) / slot.heightPx
    return Math.round(slot.clip.endMs - fraction * duration)
  }

  const oldest = axis.clips[axis.clips.length - 1]
  return oldest?.startMs ?? topMs
}
