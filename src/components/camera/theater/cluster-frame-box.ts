/**
 * cluster-frame-box — the metrics of a cluster's gallery panel.
 *
 * Every cluster is drawn as ONE panel (`ClusterCard`): a row of thumbnails, one
 * per subject, with a caption under each. The panel's height is the card height
 * the clusterer and the positioning use, so it lives here once. The thumbnails
 * are the former gallery overlay's (124 x 76 image, 102 high with its caption),
 * 20 % larger in width and height.
 *
 * Clips mode (`paging === false`) uses a single centred 16:9 thumbnail instead.
 */
import { SPACING } from '../../../theme/tokens.js'

const PANEL_SCALE = 1.2

/** The thumbnail image height (was 76). */
export const CLUSTER_PANEL_THUMB_HEIGHT = Math.round(76 * PANEL_SCALE)

/** One member's box: the image plus its caption strip (was 102). */
export const CLUSTER_PANEL_ITEM_HEIGHT = Math.round(102 * PANEL_SCALE)

/** Room above and below the row inside the panel. */
const PANEL_VERTICAL_ROOM = 40

/** The panel's — and so the cluster card's — height, for any width. */
export const CLUSTER_PANEL_HEIGHT = CLUSTER_PANEL_ITEM_HEIGHT + PANEL_VERTICAL_ROOM

/** Caption strip under a clips-mode 16:9 thumb (matches carousel caption). */
export const CLUSTER_CLIP_CAPTION_HEIGHT = 26

const CLUSTER_CLIP_VERTICAL_ROOM = 24

/** A thumbnail's width for a panel width: ~2.4 visible, within 106..149. */
export function clusterPanelItemWidth(panelWidth: number): number {
  const fit = Math.floor(((panelWidth - SPACING.lg) / 2.4) * PANEL_SCALE)
  return Math.max(Math.round(88 * PANEL_SCALE), Math.min(Math.round(124 * PANEL_SCALE), fit))
}

/** Inner width for a clips card's single 16:9 thumb. */
export function clusterClipThumbWidth(cardWidth: number): number {
  return Math.max(0, cardWidth - SPACING.md * 2)
}

/** One clips visit row: 16:9 image plus caption. */
export function clusterClipItemHeight(cardWidth: number): number {
  const w = clusterClipThumbWidth(cardWidth)
  if (w <= 0) return 0
  return Math.round((w * 9) / 16) + CLUSTER_CLIP_CAPTION_HEIGHT
}

/** Clips-mode card height once the width is measured. */
export function clusterClipCardHeight(cardWidth: number): number {
  if (cardWidth <= 0) return 0
  return clusterClipItemHeight(cardWidth) + CLUSTER_CLIP_VERTICAL_ROOM
}

/** The card height for a card width (0 until the width is measured). */
export function clusterCardHeight(cardWidth: number, clips = false): number {
  if (cardWidth <= 0) return 0
  return clips ? clusterClipCardHeight(cardWidth) : CLUSTER_PANEL_HEIGHT
}
