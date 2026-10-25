/**
 * client-hints — build the `hints` payload for webrtcSession session creation
 * from the player's measured layout. Pure (pixel ratio injected — the caller
 * passes `PixelRatio.get()` on native / `window.devicePixelRatio` on web) so
 * the mapping is unit-testable in the node test env.
 *
 * Mirrors the ui-library reference `computeClientHints` (camera-stream-player):
 * viewport = the PLAYER's rendered size in physical pixels (layout pt × ratio),
 * so the server's adaptive selection can pick a tier that actually fits the
 * surface (a grid tile shouldn't pull the 4K ladder rung).
 */
import type { ClientStreamHints } from './signaling-types.js'

/** True for a finite, strictly positive number. */
function isPositive(v: number): boolean {
  return Number.isFinite(v) && v > 0
}

/**
 * Map a measured layout box (+ pixel ratio, + optional downlink estimate) onto
 * the server's `webrtcClientHintsSchema` shape. Unmeasured sizes (0/NaN) are
 * omitted rather than sent as garbage; an invalid ratio degrades to 1.
 */
export function buildClientHints(
  layoutWidth: number,
  layoutHeight: number,
  pixelRatio: number,
  downlinkMbps?: number,
): ClientStreamHints {
  const ratio = isPositive(pixelRatio) ? pixelRatio : 1
  const measured = isPositive(layoutWidth) && isPositive(layoutHeight)
  return {
    ...(measured
      ? {
          viewportWidth: Math.round(layoutWidth * ratio),
          viewportHeight: Math.round(layoutHeight * ratio),
        }
      : {}),
    devicePixelRatio: ratio,
    ...(downlinkMbps !== undefined && Number.isFinite(downlinkMbps) && downlinkMbps >= 0
      ? { downlinkMbps }
      : {}),
  }
}
