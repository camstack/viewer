/**
 * timeline-toolbar-fit — how the single-camera header compacts, in steps, for
 * the width its row actually has. Every button stays visible and reachable;
 * there is no overflow menu.
 *
 * ## Why
 *
 * In landscape the header lives in the edge drawer (240–340 pt, less the notch
 * on that side) and the widest real set — back, date, battery + link + stream
 * badges, and the five actions (linked devices, PTZ, settings, quality, camera
 * switch) — is ~450 pt. `flexWrap: 'nowrap'` plus `flexShrink: 0` on the
 * capsules meant the overflow went off-screen, clipped. A `⋯` menu fixed that
 * but opened a RN Modal, which rotates the app on iOS, and hid buttons the
 * operator wanted in reach.
 *
 * ## The rule
 *
 * Pure, so it is asserted by value. Start from today's look (step 0) and, while
 * the row does not fit the budget, apply the next of {@link COMPACT_STEPS} —
 * cumulatively — and stop at the first that fits:
 *
 *   1. `gaps`    — tighter row gap and row padding;
 *   2. `short`   — the date pill drops its weekday ("17 ott");
 *   3. `day`     — the date pill is icon + day number;
 *   4. `quality` — the quality chip is a glyph, not a word;
 *   5. `small`   — every control goes from 36 to 30 pt.
 *
 * If even the last step does not fit, the row renders the last step anyway: the
 * date pill has `flexShrink`, nothing is hidden and nothing is clipped. Status
 * badges are never dropped.
 */
import { SPACING } from '../../../theme/tokens.js'

export type ToolbarActionId = 'linked' | 'ptz' | 'settings' | 'quality' | 'camera'

/** Diameter of every toolbar control at step 0 — what `TOOLBAR_CONTROL_SIZE` exports. */
export const FIT_CONTROL_SIZE = 36
/** Diameter once the row has to give up room (step 5). */
export const SMALL_CONTROL_SIZE = 30
/** The quality chip draws a word at steps 0..3 (wider than a control). */
const QUALITY_WORD_WIDTH = 44
/** A status badge slot at step 0 (glyph + horizontal padding); scales with the control. */
const STATUS_SLOT_WIDTH = 28

/** Width the date pill needs per format (icon, label, chevron, padding). */
export const DATE_WIDTH = { full: 96, short: 80, day: 56 } as const
export type DateFormat = keyof typeof DATE_WIDTH

/** Gap between the row's children, relaxed and tight. */
export const ROW_GAP = SPACING.md
export const ROW_GAP_TIGHT = SPACING.sm
/** Left/right padding of the row, relaxed and tight. */
export const ROW_PADDING = SPACING.lg
export const ROW_PADDING_TIGHT = SPACING.md

export type CompactStep = 'gaps' | 'short' | 'day' | 'quality' | 'small'
/** Applied in this order, cumulatively. */
export const COMPACT_STEPS: readonly CompactStep[] = ['gaps', 'short', 'day', 'quality', 'small']

export interface ToolbarFitInput {
  /** The row's measured width, or `null` before the first layout. */
  readonly rowWidth: number | null
  /** Extra right padding: the safe-area inset of the notch side. */
  readonly insetRight?: number
  readonly showBack: boolean
  /** Actions the caller supplied, any order. */
  readonly actions: readonly ToolbarActionId[]
  /** How many status badges are visible (battery, link, stream). */
  readonly statusBadges: number
}

export interface ToolbarFit {
  /** Gap between the row's children. */
  readonly gap: number
  /** Left/right padding of the row (the notch inset comes on top, on the right). */
  readonly padding: number
  readonly dateFormat: DateFormat
  /** The quality chip is a glyph (its accessibility label still names the tier). */
  readonly qualityIconOnly: boolean
  /** Diameter of back, segments and status slots. */
  readonly controlSize: number
  /** Width the row needs at this step (for tests and diagnostics). */
  readonly needed: number
  /** How many of {@link COMPACT_STEPS} were applied (0 = today's look). */
  readonly step: number
}

type Layout = Omit<ToolbarFit, 'needed' | 'step'>

function layoutAt(step: number): Layout {
  return {
    gap: step >= 1 ? ROW_GAP_TIGHT : ROW_GAP,
    padding: step >= 1 ? ROW_PADDING_TIGHT : ROW_PADDING,
    dateFormat: step >= 3 ? 'day' : step >= 2 ? 'short' : 'full',
    qualityIconOnly: step >= 4,
    controlSize: step >= 5 ? SMALL_CONTROL_SIZE : FIT_CONTROL_SIZE,
  }
}

function neededWidth(input: ToolbarFitInput, layout: Layout): number {
  const { controlSize, gap } = layout
  const hasActions = input.actions.length > 0
  const statusSlot = Math.round((STATUS_SLOT_WIDTH * controlSize) / FIT_CONTROL_SIZE)
  // Children: back?, date, spacer, badges…, actions capsule?
  const children = (input.showBack ? 1 : 0) + 2 + input.statusBadges + (hasActions ? 1 : 0)
  const actionsWidth = input.actions.reduce(
    (sum, id) => sum + (id === 'quality' && !layout.qualityIconOnly ? QUALITY_WORD_WIDTH : controlSize),
    0,
  )
  const widths =
    (input.showBack ? controlSize : 0) +
    DATE_WIDTH[layout.dateFormat] +
    input.statusBadges * statusSlot +
    actionsWidth
  return widths + (children - 1) * gap
}

export function fitToolbar(input: ToolbarFitInput): ToolbarFit {
  const inset = input.insetRight ?? 0
  const last = COMPACT_STEPS.length
  let step = 0
  for (; step < last; step++) {
    const layout = layoutAt(step)
    const budget = input.rowWidth === null ? Number.POSITIVE_INFINITY : input.rowWidth - layout.padding * 2 - inset
    if (neededWidth(input, layout) <= budget) break
  }
  const layout = layoutAt(step)
  return { ...layout, needed: neededWidth(input, layout), step }
}
