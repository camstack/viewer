/**
 * overlay-size — how big the indicators on a hosted grid tile are drawn.
 *
 * The embed's mirror of the app's `components/camera/overlay/overlay-size.ts`
 * (the embed is a separate bundle and cannot import it; a parity spec in the
 * app's suite pins that the two agree). The rule is the same: the device's
 * level (`small | medium | large`) is a share of the RENDERED PICTURE width,
 * turned into a multiplier of the 11 px base every indicator was designed at,
 * and clamped so a small tile stays legible and a big one does not draw a
 * banner.
 *
 * Instead of threading the number through every component, the tile publishes
 * it as the CSS custom property `--ov` on the frame that holds the indicators,
 * and every dimension is written `ov(n)` = `calc(n px * var(--ov))`. A tile with
 * no frame (or an older host that sends no size) reads the fallback `1`.
 *
 * Pure — no DOM, no React.
 */
import type { CSSProperties } from 'react'

export const OVERLAY_SIZES = ['small', 'medium', 'large'] as const
export type OverlaySize = (typeof OVERLAY_SIZES)[number]
export const DEFAULT_OVERLAY_SIZE: OverlaySize = 'medium'

export function isOverlaySize(v: unknown): v is OverlaySize {
  return typeof v === 'string' && (OVERLAY_SIZES as readonly string[]).includes(v)
}

/** The text size every indicator's styles were written at. */
export const BASE_FONT_PX = 11
export const OVERLAY_SIZE_SHARE: Readonly<Record<OverlaySize, number>> = {
  small: 0.012,
  medium: 0.018,
  large: 0.028,
}
export const OVERLAY_SIZE_MIN_SCALE: Readonly<Record<OverlaySize, number>> = {
  small: 0.5,
  medium: 0.6,
  large: 0.75,
}
export const MAX_SCALE = 2

/** The multiplier for a picture `pictureWidth` CSS px wide. 1 when unmeasured. */
export function overlayScale(pictureWidth: number, size: OverlaySize): number {
  if (!Number.isFinite(pictureWidth) || pictureWidth <= 0) return 1
  const raw = (pictureWidth * OVERLAY_SIZE_SHARE[size]) / BASE_FONT_PX
  return Math.min(MAX_SCALE, Math.max(OVERLAY_SIZE_MIN_SCALE[size], raw))
}

/** The custom property the frame publishes. */
export const OVERLAY_SCALE_VAR = '--ov'

/** One dimension in px, multiplied by the frame's scale. */
export function ov(px: number): string {
  return `calc(${px}px * var(${OVERLAY_SCALE_VAR}, 1))`
}

/** The frame's style: publishes `--ov`. */
export function scaleVarStyle(scale: number): CSSProperties {
  // CSSProperties has no index for custom properties; the DOM accepts them.
  return { [OVERLAY_SCALE_VAR]: scale } as CSSProperties
}
