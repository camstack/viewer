/**
 * Width-derived UI tokens for the timeline.
 *
 * ## Why this exists
 *
 * The landscape drawer is an OVERLAY on the video, so every point it is wide is
 * a point of stream the operator cannot see. Narrowing it is therefore the whole
 * feature — but narrowing the CONTAINER alone does not narrow what is in it.
 *
 * The first cut threaded a `compact` boolean down the tree and multiplied
 * individual dimensions by hand at each site (`compactDim(30, compact)`,
 * `compactDim(40, true)`, …). That approach has one defect and it is fatal: it
 * only shrinks the values somebody remembered to wrap. Every element added
 * later, and every element missed, keeps its full-screen size — which is exactly
 * the report this module answers ("many elements do not scale with the maximum
 * width").
 *
 * So the scale is derived ONCE from the available width and published as a token
 * set. A component reads `useTimelineScale()` and sizes itself from the tokens;
 * it never learns whether it is in a drawer, and nothing has to be re-scaled by
 * hand when the drawer's width changes again.
 *
 * ## The scale
 *
 * `scale = width / REFERENCE_WIDTH`, clamped. The reference is a phone's
 * portrait width, where the timeline was designed and where the tokens must come
 * out byte-identical to the constants they replaced. Below the reference the
 * chrome shrinks proportionally; above it nothing grows — a tablet gets more
 * timeline, not a bigger play button.
 */

import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'

/**
 * Width (pt) at which every token equals its full-size value. A 390pt iPhone
 * portrait column — the geometry the timeline's constants were chosen against.
 */
export const REFERENCE_WIDTH = 390

/**
 * Floor for the derived scale. At 0.66 a 30pt button is 20pt, which is the
 * smallest a finger reliably hits; below that the panel stops being usable
 * rather than becoming compact.
 */
export const MIN_SCALE = 0.66

/**
 * Ceiling for the WIDTH-derived part. Chrome does not grow just because the
 * screen is wide — see the module header. An explicit density choice is a
 * different thing and multiplies this (see {@link TOOLBAR_DENSITY_FACTOR}):
 * a wide screen is not a request for bigger chrome, but asking for 'large' is.
 */
export const MAX_SCALE = 1

/**
 * How tall the operator wants the single-camera player's toolbar.
 *
 * `small` is what shipped, and it is the default: nobody's toolbar changes
 * until they ask. The factor MULTIPLIES the width-derived scale rather than
 * replacing it, so the geometry still wins where it must — a 200pt drawer
 * cannot host a phone-sized toolbar because the operator picked 'large'.
 */
export type ToolbarDensity = 'small' | 'medium' | 'large'

/**
 * `small` is 1 — the size the chrome had before this setting existed — which is
 * why it is also the DEFAULT PARAMETER of the functions below: "no density
 * supplied" must mean "unchanged", and `FULL_SIZE_TOKENS` depends on it.
 *
 * The SETTING's default is `medium` (`settings-store.ts`), a different question
 * with a different answer: what a new operator should get. The two defaults are
 * deliberately not the same value.
 */
export const TOOLBAR_DENSITY_FACTOR: Record<ToolbarDensity, number> = {
  small: 1,
  medium: 1.2,
  large: 1.45,
}

export interface TimelineScaleTokens {
  /** The raw factor, for a caller that must derive something not tokenised. */
  readonly scale: number
  /** The container width the tokens were derived from — for the one layout
   *  decision that is about ROOM, not size (`toolbar-status-layout.ts`). */
  readonly width: number
  /** Gaps and paddings — same keys as the theme's `SPACING`. */
  readonly space: Record<keyof typeof SPACING, number>
  /** Corner radii — same keys as the theme's `RADIUS`. */
  readonly radius: Record<keyof typeof RADIUS, number>
  /** Text sizes — same keys as `TYPOGRAPHY.size`. */
  readonly font: Record<keyof typeof TYPOGRAPHY.size, number>
  /** Square tap targets, by role. */
  readonly control: {
    /** Toolbar icon button. */
    readonly button: number
    /** Toolbar chevron / stepper. */
    readonly arrow: number
    /** The primary play/pause target — the one control that must stay big. */
    readonly primary: number
  }
  /** Glyph sizes for icons drawn inside the controls above. */
  readonly icon: {
    readonly xs: number
    readonly sm: number
    readonly md: number
  }
  /**
   * Scale an arbitrary dimension.
   *
   * The named tokens cover the roles that recur; this covers everything else
   * WITHOUT anyone having to remember a `compact` flag. A new element writes
   * `ui.px(22)` and scales correctly from the day it is added — which is the
   * property the hand-multiplied version did not have.
   */
  readonly px: (value: number) => number
}

/**
 * Round a scaled dimension to a whole point so borders stay crisp, and never
 * let it collapse to zero.
 */
function dim(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) return value
  return Math.max(1, Math.round(value * scale))
}

/**
 * {@link dim}, for a caller that must PRICE a token before it is drawn
 * (`playback-bar-fit.ts`): the estimate has to round exactly the way the
 * tokens do, or ten rounded gaps drift a few points away from the bar it
 * describes.
 */
export function scaleDimension(value: number, scale: number): number {
  return dim(value, scale)
}

function mapValues<K extends string>(
  source: Readonly<Record<K, number>>,
  scale: number,
): Record<K, number> {
  const out = {} as Record<K, number>
  for (const key of Object.keys(source) as K[]) out[key] = dim(source[key], scale)
  return out
}

/**
 * The scale factor for an available width. Exported so a test — and a caller
 * that needs the number before it has a token set — can assert it directly.
 */
export function scaleForWidth(
  availableWidth: number,
  density: ToolbarDensity = 'small',
): number {
  const factor = TOOLBAR_DENSITY_FACTOR[density]
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return MAX_SCALE * factor
  const raw = availableWidth / REFERENCE_WIDTH
  // The width clamp applies to the width term ONLY; density then multiplies it.
  // Clamping AFTER would make every density identical at or above the reference
  // width, which is precisely where the operator asked for a taller bar.
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)) * factor
}

/**
 * Build the token set for an available width.
 *
 * At or above {@link REFERENCE_WIDTH} this returns the full-size values, so a
 * caller outside the drawer renders exactly as it did before tokens existed.
 */
export function timelineTokens(
  availableWidth: number,
  density: ToolbarDensity = 'small',
): TimelineScaleTokens {
  const scale = scaleForWidth(availableWidth, density)
  return {
    scale,
    width: availableWidth,
    space: mapValues(SPACING, scale),
    radius: mapValues(RADIUS, scale),
    font: mapValues(TYPOGRAPHY.size, scale),
    control: {
      button: dim(30, scale),
      arrow: dim(28, scale),
      primary: dim(40, scale),
    },
    icon: {
      xs: dim(11, scale),
      sm: dim(14, scale),
      md: dim(18, scale),
    },
    px: (value: number) => dim(value, scale),
  }
}

/** The unscaled set — the default for anything rendering at full width. */
export const FULL_SIZE_TOKENS: TimelineScaleTokens = timelineTokens(REFERENCE_WIDTH)
