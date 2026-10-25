/**
 * cluster-proximity — the pure model behind cursor-near cluster highlighting.
 *
 * The card never scales or moves: the factor is only a selection cue while the
 * separate fan overlay owns expanded track interaction.
 *
 * Proximity measures the card's rectangle (top on `anchorMs`, extending down
 * `heightPx`), never semantic importance or the viewport midpoint.
 *
 * The other side of the comparison is the fixed time cursor. A cluster is near
 * only when its rectangle is at that cursor; viewport position alone
 * must never activate it.
 *
 * Distance is measured in PIXELS (via `pxPerHour`), not milliseconds, so the
 * feel is zoom-invariant: a card two finger-widths from the indicator behaves
 * the same whether those pixels span three minutes or three hours.
 *
 * Factors are QUANTISED before they reach React. The playhead advances many
 * times a second during playback, and a raw factor would hand every nearby
 * card a fresh prop on every report — the same 60Hz-render shape the scroll
 * offset fix removed (see `scrollOffsetRef` in TheaterTimeline). Steps of 1/20
 * mean a card re-renders at most 20 times across the whole approach, and the
 * map builder returns the SHARED empty map whenever nothing is near so the
 * common case (playhead far from every cluster) never changes identity at all.
 */

import { msPerPixel, pxPerHour } from './timeline-geometry.js'
import type { PositionedCluster } from './event-cluster.js'

const MS_PER_HOUR = 3_600_000

// ─── Tunables ─────────────────────────────────────────────────────────

/** Radius (px of timeline, at the current zoom) within which a cluster starts
 *  expanding. ~1.5 card heights at the default portrait card width. */
export const EXPANSION_RADIUS_PX = 200

/** Quantisation steps for the factor — the prop-churn bound (see module doc). */
export const EXPANSION_STEPS = 20

// ─── Cluster rectangle ────────────────────────────────────────────────
//
// A card's TOP edge sits on `anchorMs` and it extends DOWN over `heightPx`
// (`event-cluster.ts`), so the span of time it covers runs from the anchor to
// `anchorMs - heightPx * msPerPixel`. "Near the cursor" is measured against
// that rectangle — its centre for the expansion cue, its edges for the detent —
// never against the anchor alone, or a cursor on a member in the lower half of
// the card would read as far from it and light the neighbour instead.

/** The epoch at the vertical middle of the card's rectangle. */
export function clusterCenterMs(cluster: PositionedCluster, zoomIndex: number): number {
  return cluster.anchorMs - (cluster.heightPx / 2) * msPerPixel(zoomIndex)
}

/** Timeline distance in px from `epochMs` to the card's rectangle (0 inside). */
export function distanceToClusterPx(
  cluster: PositionedCluster,
  epochMs: number,
  zoomIndex: number,
): number {
  const bottomMs = cluster.anchorMs - cluster.heightPx * msPerPixel(zoomIndex)
  const outsideMs = epochMs > cluster.anchorMs ? epochMs - cluster.anchorMs : Math.max(0, bottomMs - epochMs)
  return (outsideMs / MS_PER_HOUR) * pxPerHour(zoomIndex)
}

// ─── Expansion factor ─────────────────────────────────────────────────

/**
 * Proximity factor 0..1 for a cluster centred at `centerEpochMs` while the
 * fixed time cursor sits at `anchorEpochMs`, at the given zoom.
 *
 * 0 at/beyond `radiusPx` of timeline distance, 1 when the anchor is exactly
 * on the centre, smoothstep in between (progressive, no pop at either end).
 * Pure — no time source, no animation state.
 */
export function clusterExpansion(
  centerEpochMs: number,
  anchorEpochMs: number,
  zoomIndex: number,
  radiusPx: number = EXPANSION_RADIUS_PX,
): number {
  if (radiusPx <= 0) return 0
  const distancePx =
    (Math.abs(centerEpochMs - anchorEpochMs) / MS_PER_HOUR) * pxPerHour(zoomIndex)
  if (distancePx >= radiusPx) return 0
  const t = 1 - distancePx / radiusPx
  // smoothstep: zero slope at both ends, so the card neither pops in at the
  // radius edge nor jitters at the peak.
  return t * t * (3 - 2 * t)
}

/** Snap a factor onto the 1/`steps` grid (endpoints exact). See module doc for
 *  why factors are quantised before they become props. */
export function quantiseExpansion(factor: number, steps: number = EXPANSION_STEPS): number {
  if (factor <= 0) return 0
  if (factor >= 1) return 1
  return Math.round(factor * steps) / steps
}

// ─── Per-render expansion map ─────────────────────────────────────────

export type ClusterExpansionMap = ReadonlyMap<string, number>

/** The shared "nothing is near" map — one identity, so the common case never
 *  breaks a memo. */
export const EMPTY_EXPANSION: ClusterExpansionMap = new Map<string, number>()

/**
 * Quantised expansion factor per cluster id for one render. Only clusters with
 * a factor > 0 get an entry (absent ⟺ 0), and a run with no nearby cluster
 * returns {@link EMPTY_EXPANSION} — the caller pins identity across renders
 * with {@link expansionMapsEqual}. `anchorEpochMs` is the fixed time cursor's
 * epoch. `null` (live mode, or no playhead yet) disables activation.
 */
export function buildExpansionMap(
  clusters: readonly PositionedCluster[],
  anchorEpochMs: number | null,
  zoomIndex: number,
): ClusterExpansionMap {
  if (anchorEpochMs === null || clusters.length === 0) return EMPTY_EXPANSION
  let map: Map<string, number> | null = null
  for (const cluster of clusters) {
    const factor = quantiseExpansion(
      clusterExpansion(clusterCenterMs(cluster, zoomIndex), anchorEpochMs, zoomIndex),
    )
    if (factor <= 0) continue
    if (map === null) map = new Map<string, number>()
    map.set(cluster.id, factor)
  }
  return map ?? EMPTY_EXPANSION
}

// ─── Detent: which cluster is UNDER the cursor ────────────────────────
//
// Distinct from expansion, and deliberately tighter. Expansion is a gradual
// visual cue over ~200px so a card lights up as you approach; a detent is a
// discrete "you are on it now", and reusing the expansion radius would fire it
// while the cluster was still a finger-width away — the notch would not line up
// with the thing the operator sees under the cursor.

/**
 * Radius (px of timeline, at the current zoom) within which a cluster counts as
 * being UNDER the cursor for detent purposes. About one card height: close
 * enough that the pulse coincides with the card passing the indicator.
 */
export const DETENT_RADIUS_PX = 28

/**
 * The id of the cluster under the cursor at `anchorEpochMs`, or null when the
 * cursor is over empty track. Nearest wins when two clusters are both in range
 * (dense hours overlap), so the key changes exactly once per crossing rather
 * than flickering between neighbours.
 *
 * Pure, and measured in the same zoom-invariant pixels as
 * {@link clusterExpansion}, so the notches feel identically spaced at every
 * zoom level.
 */
export function nearestClusterId(
  clusters: readonly PositionedCluster[],
  anchorEpochMs: number,
  zoomIndex: number,
  radiusPx: number = DETENT_RADIUS_PX,
): string | null {
  if (radiusPx <= 0 || clusters.length === 0) return null
  let bestId: string | null = null
  let bestPx = radiusPx
  let bestCenterPx = Infinity
  for (const cluster of clusters) {
    const distancePx = distanceToClusterPx(cluster, anchorEpochMs, zoomIndex)
    // Inside the rectangle every card ties at 0; the nearer centre wins.
    const centerPx =
      (Math.abs(clusterCenterMs(cluster, zoomIndex) - anchorEpochMs) / MS_PER_HOUR) *
      pxPerHour(zoomIndex)
    if (distancePx < bestPx || (distancePx === bestPx && bestId !== null && centerPx < bestCenterPx)) {
      bestPx = distancePx
      bestCenterPx = centerPx
      bestId = cluster.id
    }
  }
  return bestId
}

/** Value equality for two expansion maps — the identity pin's comparator. */
export function expansionMapsEqual(a: ClusterExpansionMap, b: ClusterExpansionMap): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [id, factor] of a) {
    if (b.get(id) !== factor) return false
  }
  return true
}
