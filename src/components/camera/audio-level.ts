/**
 * audio-level — pure mapping from a live dBFS reading to a 0–6 step level for
 * the player's audio-level meter, plus the highlight presets (rungs 2 / 4 / 6)
 * and the layout model that turns an anchor into a meter orientation.
 *
 * ── Calibration ──
 * The hub's `dbfs` is a TRUE dBFS RMS over ~1 s of NORMALIZED Float32 PCM
 * ([-1,1]). Indoor audio typically lands quiet ≈ -55…-42, conversation ≈
 * -42…-25, loud ≥ -24. Six rungs span [FLOOR … CEILING] so the badge can grow
 * in colour with the level, and so the highlight overlay has three named
 * sensitivities that ARE meter rungs (2, 4, 6) rather than a free dB number.
 *
 * dBFS is ≤ 0 (0 = full scale, more negative = quieter). Silence / no reading
 * maps to 0 (no segment lit).
 */

import type { OverlayPosition } from './overlay/overlay-position.js'

/** dBFS below which nothing lights (silence / noise floor). */
export const AUDIO_METER_FLOOR_DBFS = -60

/** dBFS at (or above) which every segment lights (loud indoor audio). */
export const AUDIO_METER_CEILING_DBFS = -24

/**
 * dBFS floor for each of the 6 segments (segment N lights when `dbfs ≥ floor[N-1]`).
 * `[0]` === FLOOR and the last === CEILING.
 */
export const AUDIO_LEVEL_THRESHOLDS_DBFS: readonly number[] = [-60, -53, -46, -39, -32, -24]

/** Number of segments in the meter. */
export const AUDIO_LEVEL_STEPS = AUDIO_LEVEL_THRESHOLDS_DBFS.length

/**
 * Colour per rung, quiet → loud. The badge uses the lit segment's own colour
 * so the meter grows hotter instead of collapsing to green / amber / red.
 */
export const AUDIO_LEVEL_COLORS: readonly string[] = [
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#ef4444',
]

export function audioLevelColor(logicalIndex: number): string {
  const i = Math.min(Math.max(0, logicalIndex), AUDIO_LEVEL_COLORS.length - 1)
  return AUDIO_LEVEL_COLORS[i] ?? AUDIO_LEVEL_COLORS[0]!
}

/** Highlight overlay hold, seconds — not operator-configurable. */
export const AUDIO_HIGHLIGHT_HOLD_SEC = 5

/** Meter rungs the highlight overlay offers (low / mid / high). */
export const AUDIO_HIGHLIGHT_LEVELS = [2, 4, 6] as const

export type AudioHighlightUi = 'off' | 'low' | 'mid' | 'high'

/** The three named rungs, without the off state — what the LEVEL picker offers
 *  once the audio trigger is switched on. */
export type AudioHighlightLevel = Exclude<AudioHighlightUi, 'off'>

/** The named rungs in display order (quiet → loud). One list, so the picker and
 *  the nearest-preset search cannot offer different sets. */
export const AUDIO_HIGHLIGHT_LEVEL_ORDER: readonly AudioHighlightLevel[] = ['low', 'mid', 'high']

const UI_TO_RUNG: Readonly<Record<Exclude<AudioHighlightUi, 'off'>, (typeof AUDIO_HIGHLIGHT_LEVELS)[number]>> = {
  low: 2,
  mid: 4,
  high: 6,
}

/** dBFS floor of a named highlight preset. */
export function dbfsForAudioUi(ui: Exclude<AudioHighlightUi, 'off'>): number {
  const rung = UI_TO_RUNG[ui]
  return AUDIO_LEVEL_THRESHOLDS_DBFS[rung - 1] ?? AUDIO_METER_CEILING_DBFS
}

/**
 * The named rung a stored highlight SHOWS — asked WITHOUT regard to whether the
 * trigger is currently on.
 *
 * That independence is the whole point. The editor presents audio as a switch
 * with the level behind it (the shape `detection` has always had), so an
 * operator who turns it off and on again must land back on the rung they chose.
 * `audio: 'off'` leaves `audioDb` exactly where it was, and this reads it back;
 * only the MODE is switched. A stored legacy `'sensor'` still means the lowest
 * rung and keeps meaning it.
 */
export function audioLevelFromStored(
  mode: 'off' | 'sensor' | 'level',
  db: number,
): AudioHighlightLevel {
  if (mode === 'sensor') return 'low'
  let best: AudioHighlightLevel = 'mid'
  let bestDist = Number.POSITIVE_INFINITY
  for (const ui of AUDIO_HIGHLIGHT_LEVEL_ORDER) {
    const dist = Math.abs(db - dbfsForAudioUi(ui))
    if (dist < bestDist) {
      best = ui
      bestDist = dist
    }
  }
  return best
}

/** Map a stored highlight (legacy sensor / free dB) onto the four UI states —
 *  the three presets plus off. */
export function audioUiFromStored(
  mode: 'off' | 'sensor' | 'level',
  db: number,
): AudioHighlightUi {
  return mode === 'off' ? 'off' : audioLevelFromStored(mode, db)
}

/** Map a live dBFS reading to a 0..AUDIO_LEVEL_STEPS lit-segment count. */
export function dbfsToLevel(dbfs: number | null): number {
  if (dbfs === null || !Number.isFinite(dbfs)) return 0
  let level = 0
  for (const floor of AUDIO_LEVEL_THRESHOLDS_DBFS) {
    if (dbfs >= floor) level += 1
  }
  return level
}

/** The default meter position when first enabled from `off`. The meter's
 *  position TYPE is the shared `OverlayPosition` vocabulary (`overlay/
 *  overlay-position.ts`) — the meter no longer owns a union of its own. */
export const DEFAULT_AUDIO_METER_POSITION: OverlayPosition = 'top-center'

/** Increasing bar heights (px) for the compact corner pill, shortest first. */
export const AUDIO_METER_COMPACT_HEIGHTS: readonly number[] = [8, 11, 14, 17, 21, 26]

/** Equal-bar size for the edge strips. */
export const AUDIO_METER_STRIP = {
  horizontal: { width: 8, height: 16 },
  vertical: { width: 24, height: 7 },
  compactWidth: 4,
} as const

/** Per-segment box size for an orientation, given the segment's LOGICAL index
 *  (0 = quietest). Compact bars grow in height; the strips use equal bars. */
export function meterSegmentSize(
  orientation: AudioMeterOrientation,
  logicalIndex: number,
): { readonly width: number; readonly height: number } {
  if (orientation === 'vertical') return AUDIO_METER_STRIP.vertical
  if (orientation === 'horizontal') return AUDIO_METER_STRIP.horizontal
  const height = AUDIO_METER_COMPACT_HEIGHTS[logicalIndex] ?? AUDIO_METER_COMPACT_HEIGHTS[0]!
  return { width: AUDIO_METER_STRIP.compactWidth, height }
}

/** Render order of LOGICAL segment indices. The vertical strip stacks
 *  top→bottom, so it is reversed to light bottom→top. */
export function meterRenderOrder(orientation: AudioMeterOrientation): readonly number[] {
  const forward = Array.from({ length: AUDIO_LEVEL_STEPS }, (_, i) => i)
  return orientation === 'vertical' ? [...forward].reverse() : forward
}

/** Vertical / horizontal band of an anchor, derived from its name. Pure so the
 *  meter's absolute-placement style and the picker cell layout share one source
 *  of truth. */
export interface AudioMeterAnchorBands {
  readonly vertical: 'top' | 'center' | 'bottom'
  readonly horizontal: 'left' | 'center' | 'right'
}

/** Decompose an anchor position into its vertical + horizontal bands. Returns
 *  null for `off` (nothing to place). Tokens are matched by VALUE, not order —
 *  the name is inconsistent (`top-left` is vertical-first, but `left-center` is
 *  horizontal-first), so an axis with no edge token resolves to `center`.
 *  Exported pure for unit testing. */
export function anchorBands(position: OverlayPosition): AudioMeterAnchorBands | null {
  if (position === 'off') return null
  const tokens = position.split('-')
  const vertical = tokens.includes('top') ? 'top' : tokens.includes('bottom') ? 'bottom' : 'center'
  const horizontal = tokens.includes('left') ? 'left' : tokens.includes('right') ? 'right' : 'center'
  return { vertical, horizontal }
}

/**
 * How the meter lays itself out at a given anchor. Derived purely from the
 * anchor's bands so the meter geometry ADAPTS to where it sits:
 *   • `horizontal` — a wide strip along a top/bottom EDGE midpoint
 *     (segments grow left→right).
 *   • `vertical`   — a tall strip along a left/right SIDE midpoint
 *     (segments grow bottom→top).
 *   • `compact`    — a small VU pill in a CORNER (both bands are edges).
 * Returns null for `off` (nothing to lay out). Exported pure for unit testing.
 */
export type AudioMeterOrientation = 'horizontal' | 'vertical' | 'compact'

export function meterOrientation(position: OverlayPosition): AudioMeterOrientation | null {
  const bands = anchorBands(position)
  if (bands === null) return null
  // Corner: neither axis is centred → compact pill.
  if (bands.vertical !== 'center' && bands.horizontal !== 'center') return 'compact'
  // Edge midpoint on the horizontal axis (top/bottom-center) → horizontal strip.
  if (bands.horizontal === 'center') return 'horizontal'
  // Edge midpoint on the vertical axis (left/right-center) → vertical strip.
  return 'vertical'
}
