/**
 * overlay-size — how big the read-outs drawn over a picture are.
 *
 * ## One setting, three levels, relative to the PICTURE
 *
 * The operator picks `small | medium | large` once per device (this phone, this
 * browser — never a shared profile; see `device-settings-store`). The level is
 * a share of the stream's RENDERED VIDEO WIDTH, not of the screen and not of
 * the tile: the same camera in portrait, in landscape, fullscreen and in a
 * quarter-screen grid tile reads the same relative to its picture, and a
 * letterboxed stream is measured on the picture, not on the black bars around
 * it ({@link videoRectIn}).
 *
 * Every overlay was designed at a base text size of {@link BASE_FONT_PX}
 * (11 pt). The level turns into a multiplier of that base: the pixel size the
 * share gives, divided by the base, so `medium` on a 390-pt-wide portrait
 * picture is ~1.0 (the sizes the overlays always had) and grows with the
 * picture. The multiplier is clamped ({@link OVERLAY_SIZE_MIN_SCALE}/{@link MAX_SCALE}) —
 * a 150-pt grid tile must stay legible rather than shrink to dust, and a
 * fullscreen landscape picture must not draw a banner.
 *
 * Pure module — no React, no imports beyond types. Safe for stores and tests.
 */

export const OVERLAY_SIZES = ['small', 'medium', 'large'] as const
export type OverlaySize = (typeof OVERLAY_SIZES)[number]

export const DEFAULT_OVERLAY_SIZE: OverlaySize = 'medium'

export function isOverlaySize(v: unknown): v is OverlaySize {
  return typeof v === 'string' && (OVERLAY_SIZES as readonly string[]).includes(v)
}

/** Narrow a stored value; anything else is the default (never throws). */
export function parseOverlaySize(v: unknown): OverlaySize {
  return isOverlaySize(v) ? v : DEFAULT_OVERLAY_SIZE
}

/** The text size, in points, every overlay's styles were written at. */
export const BASE_FONT_PX = 11

/** Text size per level, as a share of the rendered video width. */
export const OVERLAY_SIZE_SHARE: Readonly<Record<OverlaySize, number>> = {
  small: 0.012,
  medium: 0.018,
  large: 0.028,
}

/** Legibility floor / banner ceiling for the multiplier. The floor is per
 *  level: `small` is chosen to get OUT of the picture's way, so it may go
 *  further down before the text stops being legible. */
export const OVERLAY_SIZE_MIN_SCALE: Readonly<Record<OverlaySize, number>> = {
  small: 0.5,
  medium: 0.6,
  large: 0.75,
}
export const MAX_SCALE = 2

/** The stream aspect every CamStack surface lays out for. */
export const DEFAULT_VIDEO_ASPECT = 16 / 9

export interface Size {
  readonly width: number
  readonly height: number
}

/** A rectangle inside a container: where the PICTURE is. */
export interface Rect extends Size {
  readonly x: number
  readonly y: number
}

/** How the player fits the video into its box: `contain` letterboxes,
 *  `cover` fills the box and crops the picture. */
export type VideoFit = 'contain' | 'cover'

function usable(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * Where the video picture sits inside a box of `box` size.
 *
 * `contain` → the largest `aspect` rectangle that fits, centred (the bars are
 * outside it). `cover` → the box itself: what the viewer sees IS the box. An
 * unmeasured box (0 / NaN) or aspect yields the whole box — the safe answer
 * for the one frame before layout lands.
 */
export function videoRectIn(box: Size, fit: VideoFit, aspect: number = DEFAULT_VIDEO_ASPECT): Rect {
  const whole: Rect = { x: 0, y: 0, width: Math.max(0, box.width), height: Math.max(0, box.height) }
  if (fit === 'cover' || !usable(box.width) || !usable(box.height) || !usable(aspect)) return whole
  const boxAspect = box.width / box.height
  if (boxAspect > aspect) {
    const width = box.height * aspect
    return { x: (box.width - width) / 2, y: 0, width, height: box.height }
  }
  const height = box.width / aspect
  return { x: 0, y: (box.height - height) / 2, width: box.width, height }
}

/** The multiplier on every overlay's base dimensions for a picture this wide. */
export function overlayScale(
  videoWidth: number,
  size: OverlaySize,
  maxScale: number = MAX_SCALE,
): number {
  if (!usable(videoWidth)) return 1
  const raw = (videoWidth * OVERLAY_SIZE_SHARE[size]) / BASE_FONT_PX
  return Math.min(maxScale, Math.max(OVERLAY_SIZE_MIN_SCALE[size], raw))
}

/** Dimension keys of a flat style that grow with the multiplier. */
const SCALED_KEYS: ReadonlySet<string> = new Set([
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'margin',
  'marginHorizontal',
  'marginVertical',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
])

/**
 * A flat style with every dimension multiplied by `scale`. Numeric values only
 * (a `'100%'` stays as written), only the keys in {@link SCALED_KEYS}: colours,
 * flex, opacity, positions and `fontWeight` are untouched. Returns a NEW object;
 * the input is never mutated.
 */
export function scaleStyle<T extends object>(style: T, scale: number): T {
  if (scale === 1) return style
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(style)) {
    out[key] = typeof value === 'number' && SCALED_KEYS.has(key) ? Math.round(value * scale * 100) / 100 : value
  }
  // Type boundary: `out` has exactly the keys of `style`, and only number
  // values were rewritten (to numbers), so it is a `T` — `Object.entries` just
  // cannot say so.
  return out as T
}
