/**
 * grid-motion — the wall's motion layer, decided by the GRID document.
 *
 * Until planning#745 a tile painted motion (regions, pill) from each camera's
 * own overlay document and the border from nothing at all, so a wall had no
 * setting that turned motion off. A grid now follows the GRID's settings: the
 * `motion` member of its layer set is the one switch for the regions, the pill
 * and the border, on the native tile and in the hosted embed alike.
 *
 * Pure — no React, no store.
 */
import type { OverlayConfig, OverlayLayer } from '../components/camera/overlay/overlay-config.js'
import type { OverlayPosition } from '../components/camera/overlay/overlay-position.js'

/** Where the wall draws the motion pill: one corner for every tile. */
export const WALL_MOTION_BADGE: OverlayPosition = 'top-right'

/** Is the wall's motion layer on? Absent from the set = off. */
export function wallMotionOn(layers: readonly OverlayLayer[]): boolean {
  return layers.includes('motion')
}

/** The overlay document a tile draws with: the camera's own for everything but
 *  motion, whose pill follows the grid's layer (a camera's own corner for it is
 *  the single view's business). */
export function wallTileOverlay(overlay: OverlayConfig, layers: readonly OverlayLayer[]): OverlayConfig {
  const badge = wallMotionOn(layers) ? WALL_MOTION_BADGE : 'off'
  return overlay.motionBadge === badge ? overlay : { ...overlay, motionBadge: badge }
}

/** A highlight config whose motion trigger also needs the grid's motion layer:
 *  the border is part of the layer, so it cannot light with the layer off. */
export function wallHighlight<T extends { readonly motion: boolean }>(
  highlight: T,
  layers: readonly OverlayLayer[],
): T {
  return wallMotionOn(layers) || !highlight.motion ? highlight : { ...highlight, motion: false }
}
