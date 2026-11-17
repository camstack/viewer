/**
 * What the playback bar's ROOM allows — as distinct from what its MODE offers.
 *
 * ## Why this exists
 *
 * `timeline-layout.ts#playbackBarLayout` answers "which controls does this
 * playback mode have a meaning for". That question has nothing to say about
 * width. This module answers the other one: given the width the bar really
 * has, at the size its tokens really draw, how must the row be laid out so
 * that no control paints over another. `styles.row` has no `overflow`, so an
 * overflow does not clip, it OVERLAPS.
 *
 * ## What it got wrong before (2026-10-06)
 *
 * The operator's web panel, timeline on the right, 380pt rail: the record dot
 * sat on top of +10s next to the speed chip, at every width. Two pricing
 * errors, both measured in a browser:
 *
 *  1. The estimate scaled by WIDTH only. The tokens scale by width times the
 *     toolbar DENSITY (`medium`, the default, is ×1.2), so the bar drawn was a
 *     fifth wider than the bar priced.
 *  2. It priced the two side groups as `leading + trailing`. They are
 *     EQUAL-WEIGHT (`styles.side`, `flex: 1`) so the play button stays at the
 *     centre — each gets half of what the centre leaves, so the row needs
 *     `2 × max(leading, trailing)`. The trailing side (record + speed, 94pt)
 *     is the wider one, and its excess spilled leftward over the transport.
 *
 * ## What THAT got wrong (2026-10-07)
 *
 * The fix wrapped a bar that plainly fitted on one row: the operator's 420pt
 * rail at `medium` drew the transport on a row of its own over LIVE and
 * record + speed, with a third of the row empty. Three causes, all of them
 * pricing, measured on the web build:
 *
 *  1. Symmetric centring was the ONLY one-row shape. `2 × max(side)` charged
 *     the narrow LIVE side for the width of record + speed — 442pt asked of a
 *     420pt bar whose controls take 411.
 *  2. The per-control constants were rounded UP by a fifth (the speed chip
 *     priced at 60, drawn at 49) and nothing ever corrected them.
 *  3. The total was `round(units × scale)`, while every token is rounded on
 *     its own — the estimate and the bar disagreed by a few points either way.
 *
 * So a one-row bar now has TWO shapes before it wraps — centred on the bar,
 * then centred in the room the side groups leave — and the variable widths
 * (the LIVE chip, the speed chip) are MEASURED by the bar itself
 * ({@link PlaybackBarMeasured}); the constants are only the first paint's
 * estimate. Everything is priced in points, token by token, rounded the way
 * the tokens round.
 *
 * ## The ladder
 *
 * In the order the operator ranked the remedies — one row with the play button
 * centred, one row with the transport centred in what the sides leave, wrap,
 * compress gaps, move the secondary controls (record, speed) into an overflow
 * — and only then shed transport:
 *
 *  1. one row, everything, the empty slots reserved (the play button never
 *     moves as the mode changes), the transport centred on the BAR;
 *  2. the same row with the transport centred in the space BETWEEN the side
 *     groups (`centring: 'between'`) — the play button sits a little off the
 *     bar's centre, which costs less than a second row;
 *  3. TWO rows, where the host can grow (`canWrap`): the transport alone on
 *     the first, centred on the full width; LIVE and the secondaries on the
 *     second. A host with a fixed chrome height (the on-demand overlay's
 *     `ONDEMAND_CHROME_HEIGHT`, the landscape drawer over the picture) never
 *     gets this rung, and goes straight on;
 *  4. tighter gaps and no reservations;
 *  5. record + speed behind ONE overflow button — nothing is lost, the menu
 *     carries both;
 *  6. then frame-step (the rarest verb, drawn only while paused), then the
 *     ±10s jog (the day tape still scrubs).
 *
 * The LIVE chip's WORD is deliberately NOT on that ladder: the lockless badge
 * IS the word, so a glyph-only tier would draw an empty coloured pill.
 *
 * ## Why the tiers are MEASURED and not chosen
 *
 * Each tier is priced from the component's own dimensions by
 * {@link estimateWidestBar} — the WORST case over every mode the bar can be
 * switched into without a resize — and {@link playbackBarFit} returns the
 * richest one that fits. The spec walks every width and density and asserts
 * the chosen tier fits at each. Pure — no React, no `Dimensions`.
 */

import { SPACING } from '../../../theme/tokens.js'
import { scaleDimension, scaleForWidth } from './timeline-scale-tokens.js'

/** Gap set for the row: the token gaps, or the next size down. */
export type PlaybackBarGaps = 'normal' | 'tight'

/** Where record + speed live: in the row, or behind one overflow button. */
export type PlaybackBarSecondary = 'inline' | 'overflow'

/**
 * What a ONE-ROW bar centres the transport on:
 *
 *  - `bar` — the bar itself: the side groups are equal-weight (`flex: 1`), so
 *    the row pays twice the wider side and the play button is the bar's centre;
 *  - `between` — the room the side groups leave: each side takes only what it
 *    draws, and the transport is centred between them. The row pays each side
 *    once. Meaningless on a wrapped bar, whose transport row is alone.
 */
export type PlaybackBarCentring = 'bar' | 'between'

/** Which layout the available WIDTH can carry. */
export interface PlaybackBarFit {
  /**
   * Keep the empty reservations around the play button, so it does not jump
   * as a mode changes under the operator. Four button-widths of courtesy —
   * the first thing to go on a row that is short of room.
   */
  readonly reserveSlots: boolean
  /** There is room for the ±10s jog pair, if the mode offers it. */
  readonly allowJog: boolean
  /** There is room for the frame-step pair, if the mode offers it. */
  readonly allowStep: boolean
  /** Two rows: transport on top, LIVE + secondaries under it. */
  readonly wrap: boolean
  readonly gaps: PlaybackBarGaps
  readonly secondary: PlaybackBarSecondary
  readonly centring: PlaybackBarCentring
}

/**
 * Widths the bar MEASURED on itself (`onLayout`), in points at the scale it is
 * drawn at. Absent ⟺ not measured yet (the first paint), or the control is not
 * on screen and never was — the estimate stands in. A width that is not a
 * positive finite number is a measurement that failed, never "zero wide".
 */
export interface PlaybackBarMeasured {
  /** The leading chip: LIVE (with or without the padlock) or Go-to-live. */
  readonly leading?: number
  /** The speed chip, with the label it currently shows. */
  readonly rate?: number
}

/** What the HOST can do and what it draws — the furniture the price depends on. */
export interface PlaybackBarHost {
  /** The token scale the bar is drawn at (`useTimelineScale().scale`), density included. */
  readonly scale: number
  /** The host's chrome may grow a second row. False ⟺ fixed-height chrome. */
  readonly canWrap: boolean
  /** The trailing side carries an icon button (record, or the clip loop). */
  readonly trailingIcon: boolean
  /** The surface binds frame-step. */
  readonly canStep: boolean
  /** What the bar has measured of its own text-sized controls. */
  readonly measured?: PlaybackBarMeasured
}

// ── The component's own dimensions, at scale 1 ────────────────────────────
//
// Measured on the web build (2026-10-07, `medium`, divided by its 1.2 scale).
// The two text-sized chips are only the FIRST paint's estimate: the bar
// measures them and the measurement replaces these. The spec pins the full
// bar's total so a change to either side has to be made on both.

/** `ui.control.button` — every square icon button. */
const BUTTON = 30
/** `ui.control.primary` — the play/pause disc. */
const PRIMARY = 40
/** The leading chip: LIVE + padlock draws 58.3, Go-to-live 57.5. */
const LEADING = 59
/** The speed chip with a short label ("1×" draws 49). */
const RATE_CHIP = 52
/** Accept with its duration: "0:12" draws 62.5; room for a longer one. */
const ACCEPT_CHIP = 72

interface GapSet {
  /** `styles.row` horizontal padding, each side. */
  readonly pad: number
  /** Between the three groups, between the centre's children, inside a side. */
  readonly gap: number
}

const GAP_SETS: Record<PlaybackBarGaps, GapSet> = {
  normal: { pad: SPACING.md, gap: SPACING.sm },
  tight: { pad: SPACING.sm, gap: SPACING.xs },
}

/** The gap tokens a tier draws with, at scale 1 — the bar multiplies by `ui.px`. */
export function playbackBarGapSet(gaps: PlaybackBarGaps): GapSet {
  return GAP_SETS[gaps]
}

/** Every dimension the price reads, in points, rounded as the bar rounds it. */
interface BarDims {
  readonly pad: number
  readonly gap: number
  readonly button: number
  readonly primary: number
  readonly leading: number
  readonly rate: number
  readonly accept: number
}

/** A measurement that can be used: a positive finite width. */
function usable(width: number | undefined): width is number {
  return width !== undefined && Number.isFinite(width) && width > 0
}

function barDims(fit: PlaybackBarFit, h: PlaybackBarHost): BarDims {
  const px = (value: number): number => scaleDimension(value, h.scale)
  const g = GAP_SETS[fit.gaps]
  const leading = h.measured?.leading
  const rate = h.measured?.rate
  return {
    pad: px(g.pad),
    gap: px(g.gap),
    button: px(BUTTON),
    primary: px(PRIMARY),
    leading: usable(leading) ? leading : px(LEADING),
    rate: usable(rate) ? rate : px(RATE_CHIP),
    accept: px(ACCEPT_CHIP),
  }
}

/** The centre cluster: five children (four slot Views + the disc), four gaps —
 *  the slot Views are rendered at zero width when empty, so the gaps are paid
 *  either way. */
function centreWidth(slots: number, d: BarDims): number {
  return d.primary + d.button * slots + d.gap * 4
}

/** The trailing side while nothing is armed: record (or loop) and speed. */
function idleTrailing(fit: PlaybackBarFit, host: PlaybackBarHost, d: BarDims): number {
  if (fit.secondary === 'overflow') return d.button
  const icon = host.trailingIcon ? d.button + d.gap : 0
  return icon + d.rate
}

function centreSlots(fit: PlaybackBarFit, host: PlaybackBarHost): number {
  if (fit.reserveSlots) return 4
  return (fit.allowJog ? 2 : 0) + (fit.allowStep && host.canStep ? 2 : 0)
}

/** One row (or a wrapped pair of rows) holding `centre` and `trailing`. */
function rowWidth(fit: PlaybackBarFit, d: BarDims, centre: number, trailing: number): number {
  const rowPad = d.pad * 2
  if (fit.wrap) {
    // Row 1 is the transport alone; row 2 is LIVE left, secondaries right.
    return Math.max(rowPad + centre, rowPad + d.leading + d.gap * 2 + trailing)
  }
  // `bar`: equal-weight sides, each as wide as the wider of the two.
  // `between`: each side as wide as it draws; the transport takes the rest.
  const sides = fit.centring === 'bar' ? 2 * Math.max(d.leading, trailing) : d.leading + trailing
  return rowPad + d.gap * 2 + centre + sides
}

/**
 * The WIDEST this fit can render — the worst case over the two shapes the bar
 * can be switched into without a resize, at the host's real token scale, in
 * points:
 *
 *  - IDLE: the transport cluster this tier carries, record + speed (or the
 *    overflow button) at the end;
 *  - ARMED: a capture or a selection running — Discard + Accept at the end,
 *    and no jog or step in the centre (the layout withdraws them). An empty
 *    reservation may be overlapped by the wider trailing side without hiding
 *    anything, so it is not priced here.
 */
export function estimateWidestBar(fit: PlaybackBarFit, width: number, host?: PlaybackBarHost): number {
  const h = host ?? defaultHost(width)
  const d = barDims(fit, h)
  const idle = rowWidth(fit, d, centreWidth(centreSlots(fit, h), d), idleTrailing(fit, h, d))
  const armed = h.trailingIcon ? rowWidth(fit, d, centreWidth(0, d), d.button + d.gap + d.accept) : 0
  return Math.max(idle, armed)
}

/** The width each side group is held at in a `between` row, in points. */
export interface PlaybackBarSideWidths {
  readonly leading: number
  readonly trailing: number
}

/**
 * What a `between` row holds each side group at, so the play button does not
 * move when the trailing side changes under the operator (live → playback
 * brings the speed chip; the record dot comes and goes) — the reservation
 * the `bar` shape gets from its equal-weight sides. Both are exactly what
 * {@link estimateWidestBar} priced for the IDLE row, so holding them can never
 * push the row past the width it was judged to fit. The ARMED trailing side
 * (Discard + Accept) may be wider; the bar drops the hold while it is up, as
 * it drops every reservation then.
 */
export function playbackBarSideWidths(fit: PlaybackBarFit, host: PlaybackBarHost): PlaybackBarSideWidths {
  const d = barDims(fit, host)
  return { leading: d.leading, trailing: idleTrailing(fit, host, d) }
}

const FULL: PlaybackBarFit = {
  reserveSlots: true,
  allowJog: true,
  allowStep: true,
  wrap: false,
  gaps: 'normal',
  secondary: 'inline',
  centring: 'bar',
}

/** Still one full row: the transport centred in what the side groups leave. */
const FULL_BETWEEN: PlaybackBarFit = { ...FULL, centring: 'between' }

/** Rungs only a host that can grow a second row may use. */
const WRAP_TIERS: readonly PlaybackBarFit[] = [
  { ...FULL, wrap: true },
  { ...FULL, wrap: true, reserveSlots: false, gaps: 'tight' },
]

/** Every host, after (or instead of) the wrap rungs. */
const SINGLE_ROW_TIERS: readonly PlaybackBarFit[] = [
  { ...FULL, reserveSlots: false, gaps: 'tight' },
  { ...FULL, reserveSlots: false, gaps: 'tight', secondary: 'overflow' },
  { ...FULL, reserveSlots: false, gaps: 'tight', secondary: 'overflow', allowStep: false },
  {
    ...FULL,
    reserveSlots: false,
    gaps: 'tight',
    secondary: 'overflow',
    allowStep: false,
    allowJog: false,
  },
]

/** The ladder for a host, richest first. Every entry is a complete answer. */
export function playbackBarTiers(canWrap: boolean): readonly PlaybackBarFit[] {
  return canWrap
    ? [FULL, FULL_BETWEEN, ...WRAP_TIERS, ...SINGLE_ROW_TIERS]
    : [FULL, FULL_BETWEEN, ...SINGLE_ROW_TIERS]
}

/** The ladder of a fixed-height host — kept as a constant for its readers. */
export const PLAYBACK_BAR_TIERS: readonly PlaybackBarFit[] = playbackBarTiers(false)

/** The tier that fits everywhere: the bottom of the ladder. */
export const NARROWEST_TIER: PlaybackBarFit = SINGLE_ROW_TIERS[SINGLE_ROW_TIERS.length - 1]

/**
 * The narrowest width the ladder has an answer for at the smallest scale, for
 * a host that records: an armed capture (Discard + Accept with its duration)
 * is the floor, and nothing in it can be dropped. Every real host is wider —
 * the landscape drawer bottoms out at 240pt, the overlay's bar at 222pt.
 */
export const NARROWEST_BAR_WIDTH = 180

/** A host about which nothing is known: no wrap, every control, width-only scale. */
function defaultHost(width: number): PlaybackBarHost {
  return { scale: scaleForWidth(width), canWrap: false, trailingIcon: true, canStep: true }
}

/**
 * Whether the bar should take a new measurement of one of its controls: a
 * usable width that differs from the one it holds by at least half a point.
 * Sub-point jitter must not re-render the bar, and a failed measurement must
 * not erase a good one.
 */
export function acceptMeasuredWidth(current: number | undefined, next: number): boolean {
  if (!usable(next)) return false
  return current === undefined || Math.abs(next - current) >= 0.5
}

/**
 * The richest tier that fits `width`.
 *
 * A width that is not a positive finite number is a measurement that FAILED,
 * and the honest render for one is the tier that fits everywhere — never the
 * full bar, which is what treating a missing measurement as "plenty of room"
 * would give.
 */
export function playbackBarFit(width: number, host?: PlaybackBarHost): PlaybackBarFit {
  if (!Number.isFinite(width) || width <= 0) return NARROWEST_TIER
  const h = host ?? defaultHost(width)
  for (const tier of playbackBarTiers(h.canWrap)) {
    if (estimateWidestBar(tier, width, h) <= width) return tier
  }
  return NARROWEST_TIER
}
